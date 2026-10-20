/**
 * agent-core depends on nothing concrete outside itself (PRD §2.3). These
 * port interfaces are structurally compatible with the real ModelProvider /
 * ToolRegistry / ApprovalGate classes defined in agent-providers / agent-tools,
 * but agent-core never imports those packages — only apps/talond does, and it
 * wires concrete instances in wherever a port is expected.
 */

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
  readonly toolCallId?: string;
}

export type JsonSchema = Record<string, unknown>;

export interface ToolSchema {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
}

export interface ProposedToolCall {
  readonly id: string;
  readonly toolId: string;
  readonly input: Record<string, unknown>;
}

export type CompletionChunk =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "toolCall"; readonly call: ProposedToolCall }
  | { readonly kind: "done" };

export interface CompletionRequest {
  readonly messages: Message[];
  readonly tools: ToolSchema[];
}

export interface ModelProviderPort {
  complete(request: CompletionRequest): AsyncIterable<CompletionChunk>;
}

export type ToolSafetyTierPort = "safeReadOnly" | "heuristicSandboxed" | "dangerousConfirmRequired";

export type ToolExecutionResultPort =
  | { readonly success: true; readonly output: unknown }
  | { readonly success: false; readonly errorCode: string; readonly errorMessage: string };

export interface ToolExecutionPortContext {
  readonly sessionId: string;
  readonly cancellation: AbortSignal;
}

export interface ToolRegistryPort {
  listSchemas(): ToolSchema[];
  resolveTier(toolId: string, input: Record<string, unknown>): ToolSafetyTierPort;
  execute(
    toolId: string,
    input: Record<string, unknown>,
    ctx: ToolExecutionPortContext,
  ): Promise<ToolExecutionResultPort>;
}

export type ApprovalDecisionPort = "approved" | "denied" | "timedOut";

export interface ApprovalGatePort {
  request(call: ProposedToolCall, tier: ToolSafetyTierPort): Promise<ApprovalDecisionPort>;
}

/** A conversation turn as persisted by `MemoryPort.compact` — a subset of
 * `Message` (no "system" role: synthetic context injections, e.g. recalled
 * episodic memory, aren't themselves persisted back into the transcript
 * they were recalled from). */
export interface MemoryTurn {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolId?: string;
}

/**
 * PRD §4 (Memory Hierarchy). Unlike `ModelProviderPort`/`ToolRegistryPort`,
 * the PRD gives `agent-memory` no formal interface (§2.2 names only
 * `ToolDefinition`/`BaseSkill`/`ModelProvider` as "the only extension
 * points") — this port fills that gap, matching the pattern this file
 * already establishes for the other three.
 */
export interface MemoryPort {
  /** Tier 1 (§4.1): USER.md content, loaded once per session. "" if absent. */
  loadProfile(): Promise<string>;

  /** Tier 2 (§4.2) recall for OBSERVE — relevant entries for this turn. */
  recallEpisodic(query: string, limit: number): Promise<readonly string[]>;

  /**
   * Tier 2+3 persistence (§3.1: "session persistence to SQLite" is a
   * COMPACT-time action). Commits `turns` accumulated since the last call,
   * runs §4.2 compaction if needed, and marks the session closed only when
   * `sessionEnding` — i.e. the gRPC session itself is ending, not just the
   * current turn.
   */
  compact(turns: readonly MemoryTurn[], sessionEnding: boolean): Promise<void>;
}

/** The "unexpanded catalog index" entry (§2.2) — id + triggerSummary only. */
export interface SkillCatalogEntryPort {
  readonly id: string;
  readonly triggerSummary: string;
}

/** A skill whose `shouldActivate` matched this turn — full body, for
 * progressive-disclosure injection (§2.2). */
export interface SkillActivationPort {
  readonly id: string;
  readonly body: string;
}

export interface SkillActivationContextPort {
  readonly userIntentSummary: string;
  readonly recentToolIds: readonly string[];
  readonly activeSkillIds: ReadonlySet<string>;
}

export interface SkillDraftEvaluationPort {
  readonly accepted: boolean;
  readonly skillId?: string;
  readonly reason: string;
}

/**
 * PRD §2.2/§4.4. Like `MemoryPort`, the PRD gives `agent-skills` no formal
 * interface of its own (§2.2 names only `ToolDefinition`/`BaseSkill`/
 * `ModelProvider` as "the only extension points") — this port fills that
 * gap for how `agent-core`'s loop talks to a *catalog* of skills, matching
 * the pattern this file already establishes for the other three.
 */
export interface SkillsPort {
  /** The index always in context (§2.2), loaded once per session. */
  listCatalog(): Promise<readonly SkillCatalogEntryPort[]>;

  /** Stage-1 `shouldActivate` over the catalog for this turn. */
  activate(ctx: SkillActivationContextPort): Promise<readonly SkillActivationPort[]>;

  /** §4.4 trigger condition #2: is there already a cataloged skill for
   * this tool-call sequence? */
  hasMatchingSkill(toolIds: readonly string[]): Promise<boolean>;

  /** §4.4's Draft→Evaluate pipeline, "Evaluate" half — given a drafted
   * SKILL.md candidate's raw text (the model call that produces it is
   * orchestrated by `AgentLoop`, since `agent-skills` has no model-calling
   * capability of its own), parses and validates it. Never writes to disk
   * or SQLite in Phase 2 (§7.2's scope cut) regardless of outcome. */
  evaluateDraft(rawDraftText: string): Promise<SkillDraftEvaluationPort>;
}
