import type { AgentState } from "../loop/agent-state.js";
import type { ProposedToolCall } from "../shared/ports.js";

/**
 * Mirrors proto/talon/daemon.proto's AgentEvent message. ApprovalRequested
 * is left out on purpose — approval is handled directly through
 * ApprovalGatePort rather than as an event on this stream.
 */
export type AgentEvent =
  | { readonly kind: "StateTransitioned"; readonly from: AgentState; readonly to: AgentState }
  | { readonly kind: "ToolCallProposed"; readonly call: ProposedToolCall }
  | { readonly kind: "ToolCallDelta"; readonly partialJson: string }
  | { readonly kind: "VerificationResult"; readonly passed: boolean; readonly reason?: string }
  | { readonly kind: "SkillSynthesized"; readonly accepted: boolean; readonly skillId?: string; readonly reason: string };
