import { randomUUID } from "node:crypto";
import type * as grpc from "@grpc/grpc-js";
import type { ApprovalDecision, ApprovalPrompter, ProposedCall } from "@talon/agent-tools";
import type { ToolSafetyTier } from "@talon/agent-tools";
import type { talon } from "@talon/grpc-contracts";

/**
 * Correlates ApprovalRequest/ApprovalDecision over the StreamSession bidi
 * stream by a wire-level call_id — independent of the tool call's own id,
 * since ApprovalPrompter.prompt() doesn't need to expose that (PRD §5.1).
 */
export class GrpcApprovalPrompter implements ApprovalPrompter {
  private readonly pending = new Map<string, (decision: ApprovalDecision) => void>();

  constructor(private readonly call: grpc.ServerDuplexStream<talon.ClientMessage, talon.ServerMessage>) {}

  async prompt(proposedCall: ProposedCall, tier: ToolSafetyTier): Promise<ApprovalDecision> {
    const callId = randomUUID();
    const decision = new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(callId, resolve);
    });

    this.call.write({
      approvalRequest: {
        callId,
        toolId: proposedCall.toolId,
        safetyTier: tier,
        inputJson: JSON.stringify(proposedCall.input),
      },
    });

    return decision;
  }

  resolveDecision(callId: string, decision: ApprovalDecision): void {
    const resolve = this.pending.get(callId);
    if (resolve) {
      resolve(decision);
      this.pending.delete(callId);
    }
  }
}
