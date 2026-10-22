import type { talon } from "@talon/grpc-contracts";
import type { AgentEventPayload } from "../shared/ipc-channels.js";

/**
 * Split out of main.ts specifically so it's importable in a test without
 * pulling in "electron" — main.ts's module-level `main().catch(...)` calls
 * `app.whenReady()` as a side effect of being imported at all, which makes
 * the whole file unsafe to import just to exercise one pure function.
 *
 * One AgentEvent.agentEvent.toolCallProposed/toolCallDelta exist on the
 * wire (daemon.proto) but neither apps/cli nor this renderer surfaces them
 * yet — same scope cut, not an oversight: the CLI's own toServerMessage
 * consumer only renders stateTransitioned/verificationResult/
 * skillSynthesized today.
 */
export function toAgentEventPayload(event: talon.AgentEvent): AgentEventPayload | undefined {
  if (event.stateTransitioned) {
    return { kind: "stateTransitioned", from: event.stateTransitioned.from, to: event.stateTransitioned.to };
  }
  if (event.verificationResult) {
    return {
      kind: "verificationResult",
      passed: event.verificationResult.passed,
      ...(event.verificationResult.reason ? { reason: event.verificationResult.reason } : {}),
    };
  }
  if (event.skillSynthesized) {
    return {
      kind: "skillSynthesized",
      accepted: event.skillSynthesized.accepted,
      ...(event.skillSynthesized.skillId ? { skillId: event.skillSynthesized.skillId } : {}),
      ...(event.skillSynthesized.reason ? { reason: event.skillSynthesized.reason } : {}),
    };
  }
  return undefined;
}
