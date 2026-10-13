import type { AgentState } from "../loop/agent-state.js";
import type { ProposedToolCall } from "../shared/ports.js";

/**
 * Mirrors proto/talon/daemon.proto's AgentEvent message. ApprovalRequested
 * and SkillSynthesized are left out of the Phase 1 union on purpose:
 * approval is handled directly through ApprovalGatePort rather than as an
 * event on this stream, and skill synthesis doesn't exist until Phase 2.
 */
export type AgentEvent =
  | { readonly kind: "StateTransitioned"; readonly from: AgentState; readonly to: AgentState }
  | { readonly kind: "ToolCallProposed"; readonly call: ProposedToolCall }
  | { readonly kind: "ToolCallDelta"; readonly partialJson: string }
  | { readonly kind: "VerificationResult"; readonly passed: boolean; readonly reason?: string };
