import type {
  AgentEventPayload,
  ApprovalDecisionPayload,
  ApprovalRequestPayload,
  ChannelOutputPayload,
  ConnectionStatus,
} from "../shared/ipc-channels.js";

/**
 * The renderer-side mirror of preload.ts's `contextBridge.exposeInMainWorld`
 * call. Deliberately re-declared here rather than `import type { TalonApi }
 * from "../preload/preload.js"` — pulling preload.ts (a main-context module
 * using @grpc/.. electron ipcRenderer) into this DOM-lib compilation would
 * make tsc -p tsconfig.renderer.json emit it a second time, overwriting the
 * real build from tsconfig.json's own project. Two sides of an IPC boundary
 * agreeing on a shape by construction, not by shared import, is normal for
 * this kind of split (same relationship a .proto-generated client/server
 * pair has).
 */
declare global {
  interface Window {
    talon: {
      sendMessage(text: string): void;
      approve(decision: ApprovalDecisionPayload): void;
      onConnectionStatus(callback: (status: ConnectionStatus) => void): void;
      onChannelOutput(callback: (payload: ChannelOutputPayload) => void): void;
      onAgentEvent(callback: (payload: AgentEventPayload) => void): void;
      onApprovalRequest(callback: (payload: ApprovalRequestPayload) => void): void;
    };
  }
}

export {};
