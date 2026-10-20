import type { Channel, ChannelInput } from "../channel/channel.js";
import { ContextBuilder } from "../context/context-builder.js";
import type { AgentEvent } from "../events/agent-event.js";
import type {
  ApprovalGatePort,
  CompletionRequest,
  MemoryPort,
  MemoryTurn,
  Message,
  ModelProviderPort,
  ProposedToolCall,
  SkillCatalogEntryPort,
  SkillsPort,
  ToolExecutionResultPort,
  ToolRegistryPort,
} from "../shared/ports.js";
import { type AgentState, type LoopTransitionEvent, transition } from "./agent-state.js";
import { type LoopBudget, defaultLoopBudget } from "./loop-budget.js";

export interface AgentLoopDeps {
  readonly modelProvider: ModelProviderPort;
  readonly toolRegistry: ToolRegistryPort;
  readonly approvalGate: ApprovalGatePort;
  readonly channel: Channel;
  readonly memory: MemoryPort;
  readonly skills: SkillsPort;
  readonly budget?: LoopBudget;
  readonly systemPrompt?: string;
  readonly sessionId?: string;
  readonly onEvent?: (event: AgentEvent) => void;
}

interface ToolCallOutcome {
  readonly call: ProposedToolCall;
  readonly result: ToolExecutionResultPort;
}

const DEFAULT_SYSTEM_PROMPT =
  "You are Talon, a helpful tool-using agent. Use tools when they help answer the request.";

/** Phase 1 stand-in for real §4.2 token-budget compaction: a fixed turn-count window. */
const PHASE_1_MAX_CONTEXT_TURNS = 50;

/** How many episodic entries OBSERVE recalls per turn — no PRD-specified
 * constant; kept small since recalled entries are injected into context. */
const MEMORY_RECALL_LIMIT = 5;

/** Rolling window of tool ids fed into SkillActivationContext.recentToolIds
 * — no PRD-specified size; bounded so it doesn't grow unboundedly over a
 * long session. */
const RECENT_TOOL_IDS_LIMIT = 10;

/** §4.4's Draft→Evaluate pipeline, "Draft" half — the actual model call is
 * orchestrated here (agent-skills has no model-calling capability of its
 * own), asking for a candidate in exactly the frontmatter shape
 * `evaluateDraft`/`parseSkillFile` expect. */
function buildDraftPrompt(outcomes: readonly ToolCallOutcome[]): string {
  const steps = outcomes
    .map(
      (outcome, index) =>
        `${index + 1}. Called \`${outcome.call.toolId}\` with input ${JSON.stringify(outcome.call.input)} -> ${
          outcome.result.success ? "succeeded" : "failed"
        }`,
    )
    .join("\n");

  return [
    "A tool-using turn just completed successfully with this tool-call sequence:",
    steps,
    "",
    "If this looks like a genuinely reusable, repeatable workflow, draft a SKILL.md candidate in exactly this format:",
    "---",
    "id: skill.<short_snake_case_id>",
    'trigger_summary: "<one-line description of when to use this skill>"',
    "origin: synthesized",
    "confidence: <your confidence from 0.0 to 1.0 that this is a genuinely reusable skill>",
    "---",
    "# <Title>",
    "1. <step>",
    "2. <step>",
    "",
    "Respond with only the SKILL.md content above, nothing else.",
  ].join("\n");
}

function formatCatalogIndex(catalog: readonly SkillCatalogEntryPort[]): string {
  const lines = catalog.map((entry) => `- ${entry.id}: ${entry.triggerSummary}`);
  return `Available skills (their full instructions load automatically when relevant):\n${lines.join("\n")}`;
}

export class AgentLoop {
  private state: AgentState = { kind: "OBSERVE" };
  private readonly context: ContextBuilder;
  private readonly budget: LoopBudget;
  private readonly sessionId: string;
  private turnCount = 0;
  private pendingMemoryTurns: MemoryTurn[] = [];
  private recentToolIds: string[] = [];
  private activeSkillIds = new Set<string>();
  private pendingSynthesis: Promise<void>[] = [];

  constructor(private readonly deps: AgentLoopDeps) {
    this.budget = deps.budget ?? defaultLoopBudget;
    this.sessionId = deps.sessionId ?? globalThis.crypto.randomUUID();
    this.context = new ContextBuilder(deps.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
  }

  async run(): Promise<void> {
    const profile = await this.deps.memory.loadProfile();
    if (profile.length > 0) this.context.prependSystemContext(profile);

    const catalog = await this.deps.skills.listCatalog();
    if (catalog.length > 0) this.context.prependSystemContext(formatCatalogIndex(catalog));

    for await (const input of this.deps.channel.input) {
      if (this.turnCount >= this.budget.maxTurnsPerSession) {
        await this.deps.channel.emit({
          text: "Session turn budget reached — start a fresh session to continue.",
          isFinal: true,
        });
        break;
      }
      await this.runTurn(input);
      this.turnCount += 1;
      this.applyTransition({ type: "MORE_TURNS" }); // COMPACT -> OBSERVE
    }
    // The channel has closed — this is the actual end of the gRPC session,
    // as distinct from the end of any one turn (the 3 compact() call sites
    // in runTurn() below always pass sessionEnding: false).
    await this.compact(true);
    if (this.state.kind === "COMPACT") {
      this.applyTransition({ type: "SESSION_END" });
    }
    // Any still-in-flight fire-and-forget skill synthesis (triggerSkillSynthesis
    // below) must finish before run() returns — otherwise its eventual
    // emit() could call call.write(...) after grpc-server.ts's
    // .finally(() => call.end()) already fired. Each promise already
    // swallows its own rejection, so allSettled is just a drain, not error handling.
    await Promise.allSettled(this.pendingSynthesis);
  }

  /**
   * The PRD §3.1 diagram draws ACT -> VERIFY as a single pass, but a
   * tool-calling model needs to see its own tool results before it can
   * produce a final answer — and may reasonably chain several tool calls
   * before doing so. Running the real loop against Ollama surfaced this:
   * without an inner tool-round loop, the turn ended the instant a tool
   * executed, before the model ever got to summarize the result for the
   * user. verifyLoop re-plans on a failed verification exactly as the PRD
   * specifies; toolRoundLoop is the Phase 1 addition — it keeps cycling
   * PLAN -> PRE_APPROVAL -> ACT while the model keeps proposing tools,
   * stopping when a PLAN call proposes none (a final answer) or the
   * per-turn tool-call budget runs out.
   */
  private async runTurn(input: ChannelInput): Promise<void> {
    this.setState({ kind: "OBSERVE" });
    const recalled = await this.deps.memory.recallEpisodic(input.text, MEMORY_RECALL_LIMIT);
    if (recalled.length > 0) {
      // Recalled context is injected for the model to see, not persisted
      // back into the transcript it was recalled from — context.addTurn()
      // directly, bypassing the addTurn() wrapper below.
      this.context.addTurn({ role: "system", content: `Relevant memory:\n- ${recalled.join("\n- ")}` });
    }

    const activated = await this.deps.skills.activate({
      userIntentSummary: input.text,
      recentToolIds: this.recentToolIds,
      activeSkillIds: this.activeSkillIds,
    });
    for (const skill of activated) {
      // Same treatment as recalled memory above: injected for the model to
      // see, not persisted back into the transcript via addTurn()'s wrapper.
      this.context.addTurn({ role: "system", content: skill.body });
      this.activeSkillIds.add(skill.id);
    }

    this.addTurn({ role: "user", content: input.text });

    let verifyRetries = 0;
    let denialReplans = 0;

    verifyLoop: for (;;) {
      const allOutcomes: ToolCallOutcome[] = [];
      let toolCallBudgetRemaining = this.budget.maxToolCallsPerTurn;
      let sawAnyToolCall = false;

      toolRoundLoop: for (;;) {
        this.setState({ kind: "PLAN" });
        const { assistantText, toolCalls } = await this.plan();
        if (assistantText.length > 0) {
          this.addTurn({ role: "assistant", content: assistantText });
        }

        if (toolCalls.length === 0) {
          break toolRoundLoop; // final answer, nothing left to act on
        }
        sawAnyToolCall = true;

        this.setState({ kind: "PRE_APPROVAL" });
        const { approvedCalls, anyDenied } = await this.preApproval(toolCalls);

        if (anyDenied) {
          if (denialReplans >= this.budget.maxDenialReplans) {
            this.applyTransition({ type: "APPROVAL_DENIED_ABORT" });
            await this.compact();
            return;
          }
          denialReplans += 1;
          this.applyTransition({ type: "APPROVAL_DENIED_REPLAN" });
          this.addTurn({
            role: "tool",
            content:
              "One or more proposed tool calls were denied by the user. Continue without them, or propose a different approach.",
          });
          continue toolRoundLoop;
        }

        this.applyTransition({ type: "APPROVAL_GRANTED" });
        const outcomes = await this.act(approvedCalls);
        allOutcomes.push(...outcomes);

        toolCallBudgetRemaining -= approvedCalls.length;
        if (toolCallBudgetRemaining <= 0) {
          break toolRoundLoop; // tool-call budget exhausted; verify what we have
        }
        // Loop back to PLAN so the model can see these results and continue or finish.
      }

      this.setState({ kind: "VERIFY" });
      const verification = sawAnyToolCall ? this.verify(allOutcomes) : { passed: true };
      this.emit({
        kind: "VerificationResult",
        passed: verification.passed,
        ...(verification.reason !== undefined ? { reason: verification.reason } : {}),
      });

      if (verification.passed) {
        this.applyTransition({ type: "VERIFY_PASSED" }); // -> LEARN
        this.setState({ kind: "COMPACT" }); // LEARN -> COMPACT is unconditional
        this.triggerSkillSynthesis(allOutcomes);
        await this.compact();
        return;
      }

      if (verifyRetries < this.budget.maxVerifyRetries) {
        verifyRetries += 1;
        this.applyTransition({ type: "VERIFY_FAILED_RETRY" });
        this.addTurn({
          role: "tool",
          content: `Verification failed: ${verification.reason ?? "unknown reason"}. Try again.`,
        });
        continue verifyLoop;
      }

      this.applyTransition({ type: "VERIFY_FAILED_EXHAUSTED" });
      await this.compact();
      return;
    }
  }

  private async plan(): Promise<{ assistantText: string; toolCalls: ProposedToolCall[] }> {
    const request = {
      messages: this.context.buildMessages(),
      tools: this.deps.toolRegistry.listSchemas(),
    };

    let assistantText = "";
    const toolCalls: ProposedToolCall[] = [];

    for await (const chunk of this.deps.modelProvider.complete(request)) {
      if (chunk.kind === "text") {
        assistantText += chunk.text;
        await this.deps.channel.emit({ text: chunk.text, isFinal: false });
      } else if (chunk.kind === "toolCall") {
        toolCalls.push(chunk.call);
      }
    }
    await this.deps.channel.emit({ text: "", isFinal: true });

    return { assistantText, toolCalls };
  }

  private async preApproval(
    toolCalls: ProposedToolCall[],
  ): Promise<{ approvedCalls: ProposedToolCall[]; anyDenied: boolean }> {
    const approvedCalls: ProposedToolCall[] = [];
    let anyDenied = false;

    for (const call of toolCalls) {
      const tier = this.deps.toolRegistry.resolveTier(call.toolId, call.input);
      if (tier === "safeReadOnly") {
        approvedCalls.push(call);
        continue;
      }
      const decision = await this.deps.approvalGate.request(call, tier);
      if (decision === "approved") {
        approvedCalls.push(call);
      } else {
        anyDenied = true;
      }
    }

    return { approvedCalls, anyDenied };
  }

  private async act(calls: ProposedToolCall[]): Promise<ToolCallOutcome[]> {
    const outcomes: ToolCallOutcome[] = [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.budget.maxWallClockPerTurnMs);

    try {
      for (const call of calls) {
        this.emit({ kind: "ToolCallProposed", call });
        const result = await this.deps.toolRegistry.execute(call.toolId, call.input, {
          sessionId: this.sessionId,
          cancellation: controller.signal,
        });
        outcomes.push({ call, result });
        this.addTurn({
          role: "tool",
          content: JSON.stringify(result),
          toolCallId: call.id,
        });
        this.recentToolIds.push(call.toolId);
        if (this.recentToolIds.length > RECENT_TOOL_IDS_LIMIT) this.recentToolIds.shift();
      }
    } finally {
      clearTimeout(timeout);
    }

    return outcomes;
  }

  /**
   * Phase 1 deterministic-only check (exit codes / success flags). The
   * model-self-check fallback in PRD §3.1 is deferred — nothing in Phase 1
   * needs it yet since there's exactly one check to make: did every
   * approved tool call actually succeed.
   */
  private verify(outcomes: ToolCallOutcome[]): { passed: boolean; reason?: string } {
    const failed = outcomes.find((o) => !o.result.success);
    if (failed && !failed.result.success) {
      return {
        passed: false,
        reason: `tool ${failed.call.toolId} failed: ${failed.result.errorMessage}`,
      };
    }
    return { passed: true };
  }

  /**
   * §4.4 trigger conditions, the two checkable synchronously before any
   * async work: >=2 tool calls, and no tool in this turn resolved to
   * `dangerousConfirmRequired`. The latter is this design's resolution of
   * the PRD's tier-preservation gate (filled gap #3 — see design doc):
   * since a draft can't make or violate a tier claim the format has no
   * field for, a turn that needed full manual confirmation is simply
   * never eligible for synthesis in the first place. Fire-and-forget by
   * design (PRD §4.4: "not awaited by the user-facing response") — the
   * returned promise is tracked in `pendingSynthesis` so `run()` can drain
   * it before the gRPC session actually ends, never awaited here.
   */
  private triggerSkillSynthesis(outcomes: readonly ToolCallOutcome[]): void {
    if (outcomes.length < 2) return;

    const usedDangerousTool = outcomes.some(
      (outcome) => this.deps.toolRegistry.resolveTier(outcome.call.toolId, outcome.call.input) === "dangerousConfirmRequired",
    );
    if (usedDangerousTool) return;

    const promise = this.synthesizeSkillDraft(outcomes).catch((error: unknown) => {
      this.emit({
        kind: "SkillSynthesized",
        accepted: false,
        reason: `synthesis failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    });
    this.pendingSynthesis.push(promise);
  }

  private async synthesizeSkillDraft(outcomes: readonly ToolCallOutcome[]): Promise<void> {
    const toolIds = outcomes.map((outcome) => outcome.call.toolId);
    if (await this.deps.skills.hasMatchingSkill(toolIds)) return; // §4.4 trigger condition #2

    const request: CompletionRequest = {
      messages: [{ role: "system", content: buildDraftPrompt(outcomes) }],
      tools: [], // drafting is plain text generation, no tool-calling involved
    };

    let draftText = "";
    for await (const chunk of this.deps.modelProvider.complete(request)) {
      if (chunk.kind === "text") draftText += chunk.text;
    }

    const evaluation = await this.deps.skills.evaluateDraft(draftText);
    this.emit({
      kind: "SkillSynthesized",
      accepted: evaluation.accepted,
      ...(evaluation.skillId !== undefined ? { skillId: evaluation.skillId } : {}),
      reason: evaluation.reason,
    });
  }

  /** Mirrors a real conversational turn into both the live context and the
   * pending-memory buffer `compact()` drains to `MemoryPort` — the
   * synthetic OBSERVE memory-recall injection bypasses this and calls
   * `context.addTurn()` directly, since recalled context shouldn't be
   * persisted back into the transcript it was recalled from. */
  private addTurn(turn: Message & { role: "user" | "assistant" | "tool" }): void {
    this.context.addTurn(turn);
    this.pendingMemoryTurns.push({
      role: turn.role,
      content: turn.content,
      ...(turn.toolCallId !== undefined ? { toolId: turn.toolCallId } : {}),
    });
  }

  /**
   * PRD §3.1: "session persistence to SQLite" is a COMPACT-time action.
   * `sessionEnding` is only ever true from `run()`'s post-loop call — the
   * 3 in-turn call sites above always pass the default `false`.
   */
  private async compact(sessionEnding = false): Promise<void> {
    this.context.compact(PHASE_1_MAX_CONTEXT_TURNS);
    await this.deps.memory.compact(this.pendingMemoryTurns.splice(0), sessionEnding);
  }

  private setState(next: AgentState): void {
    const from = this.state;
    this.state = next;
    this.emit({ kind: "StateTransitioned", from, to: next });
  }

  private applyTransition(event: LoopTransitionEvent): void {
    const from = this.state;
    this.state = transition(from, event);
    this.emit({ kind: "StateTransitioned", from, to: this.state });
  }

  private emit(event: AgentEvent): void {
    this.deps.onEvent?.(event);
  }
}
