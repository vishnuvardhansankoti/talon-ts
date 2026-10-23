import { describe, expect, it, jest } from "@jest/globals";
import type * as grpc from "@grpc/grpc-js";
import type { talon } from "@talon/grpc-contracts";
import { GrpcApprovalPrompter } from "../src/approval/grpc-approval-bridge.js";
import { ToolSafetyTier } from "@talon/agent-tools";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeCall(): grpc.ServerDuplexStream<talon.ClientMessage, talon.ServerMessage> & { write: jest.Mock } {
  return { write: jest.fn() } as unknown as grpc.ServerDuplexStream<talon.ClientMessage, talon.ServerMessage> & {
    write: jest.Mock;
  };
}

describe("GrpcApprovalPrompter", () => {
  it("writes an approvalRequest with a UUID callId, the tool id, tier, and JSON-stringified input", () => {
    const call = fakeCall();
    const prompter = new GrpcApprovalPrompter(call);

    void prompter.prompt({ toolId: "shell.exec", input: { command: "git status" } }, ToolSafetyTier.HeuristicSandboxed);

    expect(call.write).toHaveBeenCalledTimes(1);
    const [[message]] = call.write.mock.calls as [[{ approvalRequest: talon.ApprovalRequest }]];
    expect(message.approvalRequest.callId).toMatch(UUID_RE);
    expect(message.approvalRequest.toolId).toBe("shell.exec");
    expect(message.approvalRequest.safetyTier).toBe(ToolSafetyTier.HeuristicSandboxed);
    expect(message.approvalRequest.inputJson).toBe(JSON.stringify({ command: "git status" }));
  });

  it("resolves the promise returned by prompt() once resolveDecision() is called with the matching callId", async () => {
    const call = fakeCall();
    const prompter = new GrpcApprovalPrompter(call);

    const decision = prompter.prompt({ toolId: "fs.read_file", input: {} }, ToolSafetyTier.SafeReadOnly);
    const [[message]] = call.write.mock.calls as [[{ approvalRequest: talon.ApprovalRequest }]];

    prompter.resolveDecision(message.approvalRequest.callId, "approved");
    await expect(decision).resolves.toBe("approved");
  });

  it("resolving an unknown callId is a no-op and does not throw", () => {
    const prompter = new GrpcApprovalPrompter(fakeCall());
    expect(() => prompter.resolveDecision("not-a-real-call-id", "denied")).not.toThrow();
  });

  it("tracks concurrent prompts independently by callId", async () => {
    const call = fakeCall();
    const prompter = new GrpcApprovalPrompter(call);

    const first = prompter.prompt({ toolId: "a", input: {} }, ToolSafetyTier.HeuristicSandboxed);
    const second = prompter.prompt({ toolId: "b", input: {} }, ToolSafetyTier.HeuristicSandboxed);
    const [[firstMessage], [secondMessage]] = call.write.mock.calls as [
      [{ approvalRequest: talon.ApprovalRequest }],
      [{ approvalRequest: talon.ApprovalRequest }],
    ];

    prompter.resolveDecision(secondMessage.approvalRequest.callId, "denied");
    prompter.resolveDecision(firstMessage.approvalRequest.callId, "approved");

    await expect(first).resolves.toBe("approved");
    await expect(second).resolves.toBe("denied");
  });
});
