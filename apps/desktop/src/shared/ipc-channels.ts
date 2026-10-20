/**
 * The IPC contract between the main process and the renderer, crossed only
 * through contextBridge (preload.ts) — the renderer never sees ipcRenderer,
 * @grpc/grpc-js, or the generated gRPC types directly (PRD §1.3's
 * "ELECTRON_RENDERER -->|IPC: contextBridge| ELECTRON_MAIN" arrow). Shapes
 * here are plain-JSON mirrors of the gRPC messages the main process already
 * receives from talond, trimmed to what the UI actually renders.
 */

export const RendererToMainChannel = {
  SendMessage: "talon:send-message",
  ApprovalDecision: "talon:approval-decision",
} as const;

export const MainToRendererChannel = {
  ConnectionStatus: "talon:connection-status",
  ChannelOutput: "talon:channel-output",
  AgentEvent: "talon:agent-event",
  ApprovalRequest: "talon:approval-request",
} as const;

export type ConnectionStatus =
  | { readonly phase: "starting-daemon" }
  | { readonly phase: "connecting" }
  | { readonly phase: "ready"; readonly providerStatus: string }
  | { readonly phase: "error"; readonly message: string };

export interface ChannelOutputPayload {
  readonly text: string;
  readonly isFinal: boolean;
}

export type AgentEventPayload =
  | { readonly kind: "stateTransitioned"; readonly from: string; readonly to: string }
  | { readonly kind: "verificationResult"; readonly passed: boolean; readonly reason?: string }
  | { readonly kind: "skillSynthesized"; readonly accepted: boolean; readonly skillId?: string; readonly reason?: string };

/**
 * `tier` drives the UI treatment in renderer.ts: "dangerousConfirmRequired"
 * is actually never delivered here — main.ts intercepts it and resolves it
 * with a native dialog before the renderer ever sees it (§5.1's "native
 * Electron dialog" vs. "lightweight in-flow confirmation" split). It stays
 * in the payload type anyway so the renderer's switch is exhaustive rather
 * than silently assuming a tier it can't actually receive.
 */
export interface ApprovalRequestPayload {
  readonly callId: string;
  readonly toolId: string;
  readonly safetyTier: "safeReadOnly" | "heuristicSandboxed" | "dangerousConfirmRequired";
  readonly inputJson: string;
}

export interface ApprovalDecisionPayload {
  readonly callId: string;
  readonly decision: "approved" | "denied";
}
