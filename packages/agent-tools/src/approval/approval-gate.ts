import { ToolSafetyTier } from "../base/tool-definition.js";

export interface ProposedCall {
  readonly toolId: string;
  readonly input: Record<string, unknown>;
}

export type ApprovalDecision = "approved" | "denied" | "timedOut";

/** The actual UI (CLI y/N prompt, gRPC ApprovalRequest round-trip) is injected. */
export interface ApprovalPrompter {
  prompt(call: ProposedCall, tier: ToolSafetyTier): Promise<ApprovalDecision>;
}

function argHash(input: Record<string, unknown>): string {
  return JSON.stringify(input, Object.keys(input).sort());
}

/**
 * PRD §5.1. `safeReadOnly` never reaches this gate — agent-core's
 * preApproval step short-circuits it before calling here. For
 * `heuristicSandboxed`, an in-memory auto-allow cache (keyed by toolId +
 * arg hash, no persistence in Phase 1) skips re-prompting for a call
 * already approved this session. `dangerousConfirmRequired` always
 * prompts and never caches, regardless of the answer.
 */
export class ApprovalGate {
  private readonly autoAllowCache = new Set<string>();

  constructor(private readonly prompter: ApprovalPrompter) {}

  async request(call: ProposedCall, tier: ToolSafetyTier): Promise<ApprovalDecision> {
    const cacheKey = `${call.toolId}:${argHash(call.input)}`;

    if (tier === ToolSafetyTier.HeuristicSandboxed && this.autoAllowCache.has(cacheKey)) {
      return "approved";
    }

    const decision = await this.prompter.prompt(call, tier);

    if (tier === ToolSafetyTier.HeuristicSandboxed && decision === "approved") {
      this.autoAllowCache.add(cacheKey);
    }

    return decision;
  }
}
