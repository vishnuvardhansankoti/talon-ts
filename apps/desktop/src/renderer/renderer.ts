import type { AgentEventPayload, ApprovalRequestPayload, ConnectionStatus } from "../shared/ipc-channels.js";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const statusBanner = el<HTMLDivElement>("status-banner");
const transcript = el<HTMLDivElement>("transcript");
const approvalBanner = el<HTMLDivElement>("approval-banner");
const approvalText = el<HTMLSpanElement>("approval-text");
const approvalApprove = el<HTMLButtonElement>("approval-approve");
const approvalDeny = el<HTMLButtonElement>("approval-deny");
const composer = el<HTMLFormElement>("composer");
const composerInput = el<HTMLInputElement>("composer-input");
const composerSend = el<HTMLButtonElement>("composer-send");

function appendBubble(role: "user" | "assistant"): HTMLDivElement {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  transcript.appendChild(bubble);
  transcript.scrollTop = transcript.scrollHeight;
  return bubble;
}

function appendEventLine(text: string): void {
  const line = document.createElement("div");
  line.className = "event-line";
  line.textContent = text;
  transcript.appendChild(line);
  transcript.scrollTop = transcript.scrollHeight;
}

// Mirrors one gRPC session's worth of streamed output: a new assistant
// bubble starts on the first chunk after the previous one went final (or at
// startup), exactly like apps/cli's bin/talon.ts tracking "did we just print
// a trailing newline and reset the prompt" — just rendered as bubbles
// instead of a terminal stream.
let currentAssistantBubble: HTMLDivElement | null = null;

function setComposerEnabled(enabled: boolean): void {
  composerInput.disabled = !enabled;
  composerSend.disabled = !enabled;
}

window.talon.onConnectionStatus((status: ConnectionStatus) => {
  switch (status.phase) {
    case "starting-daemon":
      statusBanner.textContent = "Starting talond...";
      break;
    case "connecting":
      statusBanner.textContent = "Connecting...";
      break;
    case "ready":
      statusBanner.textContent =
        status.providerStatus === "ready" ? "Connected" : `Connected (provider: ${status.providerStatus})`;
      setComposerEnabled(true);
      composerInput.focus();
      break;
    case "error":
      statusBanner.textContent = `Error: ${status.message}`;
      setComposerEnabled(false);
      break;
  }
});

window.talon.onChannelOutput((payload) => {
  if (!currentAssistantBubble) {
    currentAssistantBubble = appendBubble("assistant");
  }
  currentAssistantBubble.textContent += payload.text;
  transcript.scrollTop = transcript.scrollHeight;
  if (payload.isFinal) {
    currentAssistantBubble = null;
  }
});

window.talon.onAgentEvent((event: AgentEventPayload) => {
  switch (event.kind) {
    case "stateTransitioned":
      appendEventLine(`[${event.from} -> ${event.to}]`);
      break;
    case "verificationResult":
      appendEventLine(`[verify ${event.passed ? "passed" : "failed"}${event.reason ? `: ${event.reason}` : ""}]`);
      break;
    case "skillSynthesized":
      appendEventLine(
        `[skill synthesized: ${event.accepted ? `accepted (${event.skillId})` : "rejected"}${event.reason ? ` — ${event.reason}` : ""}]`,
      );
      break;
  }
});

let pendingApprovalCallId: string | null = null;

window.talon.onApprovalRequest((request: ApprovalRequestPayload) => {
  pendingApprovalCallId = request.callId;
  approvalText.textContent = `${request.toolId} (${request.safetyTier}): ${request.inputJson}`;
  approvalBanner.classList.remove("hidden");
});

function resolveApproval(decision: "approved" | "denied"): void {
  if (!pendingApprovalCallId) return;
  window.talon.approve({ callId: pendingApprovalCallId, decision });
  pendingApprovalCallId = null;
  approvalBanner.classList.add("hidden");
}

approvalApprove.addEventListener("click", () => resolveApproval("approved"));
approvalDeny.addEventListener("click", () => resolveApproval("denied"));

composer.addEventListener("submit", (submitEvent) => {
  submitEvent.preventDefault();
  const text = composerInput.value.trim();
  if (!text) return;
  appendBubble("user").textContent = text;
  currentAssistantBubble = null;
  window.talon.sendMessage(text);
  composerInput.value = "";
});
