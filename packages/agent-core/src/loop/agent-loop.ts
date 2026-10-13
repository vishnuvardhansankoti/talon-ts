import { randomUUID } from "node:crypto";
import type { Channel, ChannelInput } from "../channel/channel.js";
import { ContextBuilder } from "../context/context-builder.js";
import type { AgentEvent } from "../events/agent-event.js";
import type {
  ApprovalGatePort,
  ModelProviderPort,
  ProposedToolCall,
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

export class AgentLoop {
  private state: AgentState = { kind: "OBSERVE" };
  private readonly context: ContextBuilder;
  private readonly budget: LoopBudget;
  private readonly sessionId: string;
  private turnCount = 0;

  constructor(private readonly deps: AgentLoopDeps) {
    this.budget = deps.budget ?? defaultLoopBudget;
    this.sessionId = deps.sessionId ?? randomUUID();
    this.context = new ContextBuilder(deps.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
  }

  async run(): Promise<void> {
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
    if (this.state.kind === "COMPACT") {
      this.applyTransition({ type: "SESSION_END" });
    }
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
    this.context.addTurn({ role: "user", content: input.text });

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
          this.context.addTurn({ role: "assistant", content: assistantText });
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
            this.compact();
            return;
          }
          denialReplans += 1;
          this.applyTransition({ type: "APPROVAL_DENIED_REPLAN" });
          this.context.addTurn({
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
        // Phase 1 has no agent-skills package yet: LEARN is a pass-through.
        this.setState({ kind: "COMPACT" }); // LEARN -> COMPACT is unconditional
        this.compact();
        return;
      }

      if (verifyRetries < this.budget.maxVerifyRetries) {
        verifyRetries += 1;
        this.applyTransition({ type: "VERIFY_FAILED_RETRY" });
        this.context.addTurn({
          role: "tool",
          content: `Verification failed: ${verification.reason ?? "unknown reason"}. Try again.`,
        });
        continue verifyLoop;
      }

      this.applyTransition({ type: "VERIFY_FAILED_EXHAUSTED" });
      this.compact();
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
        this.context.addTurn({
          role: "tool",
          content: JSON.stringify(result),
          toolCallId: call.id,
        });
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

  private compact(): void {
    this.context.compact(PHASE_1_MAX_CONTEXT_TURNS);
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
