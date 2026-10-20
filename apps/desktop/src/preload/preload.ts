import { contextBridge, ipcRenderer } from "electron";
import {
  MainToRendererChannel,
  RendererToMainChannel,
  type AgentEventPayload,
  type ApprovalDecisionPayload,
  type ApprovalRequestPayload,
  type ChannelOutputPayload,
  type ConnectionStatus,
} from "../shared/ipc-channels.js";

/**
 * The only surface the renderer gets — no ipcRenderer, no Node globals.
 * Mirrors the shape of apps/cli's bin/talon.ts (sendMessage/approve plus
 * the server->client event stream), just split across a context-bridge
 * boundary instead of one process's call.on("data", ...).
 */
const talonApi = {
  sendMessage(text: string): void {
    ipcRenderer.send(RendererToMainChannel.SendMessage, text);
  },
  approve(decision: ApprovalDecisionPayload): void {
    ipcRenderer.send(RendererToMainChannel.ApprovalDecision, decision);
  },
  onConnectionStatus(callback: (status: ConnectionStatus) => void): void {
    ipcRenderer.on(MainToRendererChannel.ConnectionStatus, (_event, status) => callback(status));
  },
  onChannelOutput(callback: (payload: ChannelOutputPayload) => void): void {
    ipcRenderer.on(MainToRendererChannel.ChannelOutput, (_event, payload) => callback(payload));
  },
  onAgentEvent(callback: (payload: AgentEventPayload) => void): void {
    ipcRenderer.on(MainToRendererChannel.AgentEvent, (_event, payload) => callback(payload));
  },
  onApprovalRequest(callback: (payload: ApprovalRequestPayload) => void): void {
    ipcRenderer.on(MainToRendererChannel.ApprovalRequest, (_event, payload) => callback(payload));
  },
};

export type TalonApi = typeof talonApi;

contextBridge.exposeInMainWorld("talon", talonApi);
