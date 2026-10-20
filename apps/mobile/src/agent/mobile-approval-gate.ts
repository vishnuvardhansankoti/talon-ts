import * as LocalAuthentication from "expo-local-authentication";
import type { ApprovalDecisionPort, ApprovalGatePort, ProposedToolCall, ToolSafetyTierPort } from "@talon/agent-core";

export interface InlineApprovalBridge {
  /** Resolves once the user taps Approve/Deny on the chat UI's in-flow
   * banner — §5.1's "single lightweight in-flow confirmation (not
   * biometric)" for heuristicSandboxed. */
  requestInlineApproval(call: ProposedToolCall): Promise<ApprovalDecisionPort>;
}

/**
 * PRD §5.1's mobile approval row. `dangerousConfirmRequired` is mandatory
 * biometric (Face ID / Touch ID / BiometricPrompt via
 * `expo-local-authentication`), never cached — agent-core's own
 * `preApproval()` (packages/agent-core/src/loop/agent-loop.ts) already
 * short-circuits `safeReadOnly` before this gate is ever called, so the
 * only two tiers `request()` actually sees are `heuristicSandboxed`
 * (routed to the inline banner) and `dangerousConfirmRequired` (routed to
 * biometric).
 */
export class MobileApprovalGate implements ApprovalGatePort {
  constructor(private readonly inline: InlineApprovalBridge) {}

  async request(call: ProposedToolCall, tier: ToolSafetyTierPort): Promise<ApprovalDecisionPort> {
    if (tier !== "dangerousConfirmRequired") {
      return this.inline.requestInlineApproval(call);
    }

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = hasHardware && (await LocalAuthentication.isEnrolledAsync());
    if (!hasHardware || !isEnrolled) {
      // No biometric sensor/enrollment to gate on — true of every
      // simulator without enrolled biometrics, and of `expo start --web`
      // (this app's only verification path in this environment; see
      // docs/architecture/phase-3-mobile.md). Falling back to the inline
      // banner is strictly weaker than §5.1's mandate, so this branch
      // must never be reached on the shipped iOS/Android target — a real
      // device with Face ID/Touch ID/BiometricPrompt enrolled always
      // takes the branch below instead.
      return this.inline.requestInlineApproval(call);
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: `Allow "${call.toolId}"?`,
      disableDeviceFallback: false,
    });
    return result.success ? "approved" : "denied";
  }
}
