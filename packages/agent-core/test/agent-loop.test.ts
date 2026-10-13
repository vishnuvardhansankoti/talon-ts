import { describe, expect, it } from "@jest/globals";
import { AgentLoop } from "../src/loop/agent-loop.js";
import type { Channel, ChannelInput, ChannelOutput } from "../src/channel/channel.js";
import type { AgentEvent } from "../src/events/agent-event.js";
import type {
  ApprovalDecisionPort,
  ApprovalGatePort,
  CompletionChunk,
  CompletionRequest,
  ModelProviderPort,
  ProposedToolCall,
  ToolExecutionPortContext,
  ToolExecutionResultPort,
  ToolRegistryPort,
  ToolSafetyTierPort,
} from "../src/shared/ports.js";

function fakeChannel(inputs: ChannelInput[]): Channel & { outputs: ChannelOutput[] } {
  const outputs: ChannelOutput[] = [];
  return {
    channelId: "fake",
    outputs,
    input: (async function* () {
      for (const input of inputs) yield input;
    })(),
    async emit(output) {
      outputs.push(output);
    },
  };
}

function fakeModelProvider(scripts: CompletionChunk[][]): ModelProviderPort {
  let call = 0;
  return {
    async *complete(_request: CompletionRequest) {
      const script = scripts[Math.min(call, scripts.length - 1)];
      call += 1;
      for (const chunk of script ?? []) yield chunk;
    },
  };
}

describe("AgentLoop", () => {
  it("runs a plain conversational turn with no tool calls", async () => {
    const channel = fakeChannel([{ text: "hello" }]);
    const events: AgentEvent[] = [];
    const toolRegistry: ToolRegistryPort = {
      listSchemas: () => [],
      resolveTier: () => "safeReadOnly",
      execute: async () => ({ success: true, output: null }),
    };
    const approvalGate: ApprovalGatePort = { request: async () => "approved" };
    const modelProvider = fakeModelProvider([[{ kind: "text", text: "hi there" }, { kind: "done" }]]);

    const loop = new AgentLoop({
      modelProvider,
      toolRegistry,
      approvalGate,
      channel,
      onEvent: (e) => events.push(e),
    });

    await loop.run();

    expect(channel.outputs.some((o) => o.text === "hi there")).toBe(true);
    expect(events.some((e) => e.kind === "VerificationResult" && e.passed)).toBe(true);
    expect(events.some((e) => e.kind === "StateTransitioned" && e.to.kind === "COMPACT")).toBe(true);
  });

  it("executes an approved safe tool call and verifies success", async () => {
    const channel = fakeChannel([{ text: "read the file" }]);
    const events: AgentEvent[] = [];
    let executed: { toolId: string; input: Record<string, unknown> } | undefined;

    const toolRegistry: ToolRegistryPort = {
      listSchemas: () => [{ id: "fs.read_file", description: "read a file", inputSchema: {} }],
      resolveTier: () => "safeReadOnly",
      execute: async (toolId, input, _ctx: ToolExecutionPortContext): Promise<ToolExecutionResultPort> => {
        executed = { toolId, input };
        return { success: true, output: "file contents" };
      },
    };
    const approvalGate: ApprovalGatePort = { request: async () => "approved" };
    const call: ProposedToolCall = { id: "call-1", toolId: "fs.read_file", input: { path: "a.txt" } };
    // Two rounds: propose the tool call, then (seeing its result) give a final answer with no more calls.
    const modelProvider = fakeModelProvider([
      [{ kind: "toolCall", call }, { kind: "done" }],
      [{ kind: "text", text: "here's the file" }, { kind: "done" }],
    ]);

    const loop = new AgentLoop({
      modelProvider,
      toolRegistry,
      approvalGate,
      channel,
      onEvent: (e) => events.push(e),
    });

    await loop.run();

    expect(executed).toEqual({ toolId: "fs.read_file", input: { path: "a.txt" } });
    expect(events.some((e) => e.kind === "VerificationResult" && e.passed)).toBe(true);
  });

  it("aborts the turn after exhausting denial-replan budget", async () => {
    const channel = fakeChannel([{ text: "run a dangerous command" }]);
    const events: AgentEvent[] = [];

    const toolRegistry: ToolRegistryPort = {
      listSchemas: () => [],
      resolveTier: (): ToolSafetyTierPort => "dangerousConfirmRequired",
      execute: async () => ({ success: true, output: null }),
    };
    const approvalGate: ApprovalGatePort = {
      request: async (): Promise<ApprovalDecisionPort> => "denied",
    };
    const call: ProposedToolCall = { id: "call-1", toolId: "shell.exec", input: { command: "rm -rf /" } };
    // Same proposal every PLAN call, since the model keeps proposing it.
    const modelProvider = fakeModelProvider([[{ kind: "toolCall", call }, { kind: "done" }]]);

    const loop = new AgentLoop({
      modelProvider,
      toolRegistry,
      approvalGate,
      channel,
      budget: {
        maxTurnsPerSession: 40,
        maxToolCallsPerTurn: 8,
        maxContextTokens: 8192,
        maxWallClockPerTurnMs: 5_000,
        maxVerifyRetries: 2,
        maxDenialReplans: 1,
      },
      onEvent: (e) => events.push(e),
    });

    await loop.run();

    const transitions = events.filter((e) => e.kind === "StateTransitioned");
    expect(transitions.some((e) => e.kind === "StateTransitioned" && e.to.kind === "COMPACT")).toBe(true);
    // No VerificationResult should ever fire — the turn was aborted at PRE_APPROVAL, never reached ACT/VERIFY.
    expect(events.some((e) => e.kind === "VerificationResult")).toBe(false);
  });

  it("retries once on tool failure, then succeeds", async () => {
    const channel = fakeChannel([{ text: "flaky task" }]);
    const events: AgentEvent[] = [];
    let attempt = 0;

    const toolRegistry: ToolRegistryPort = {
      listSchemas: () => [],
      resolveTier: () => "safeReadOnly",
      execute: async (): Promise<ToolExecutionResultPort> => {
        attempt += 1;
        return attempt === 1
          ? { success: false, errorCode: "TRANSIENT", errorMessage: "flaked" }
          : { success: true, output: "ok" };
      },
    };
    const approvalGate: ApprovalGatePort = { request: async () => "approved" };
    const call: ProposedToolCall = { id: "call-1", toolId: "flaky.tool", input: {} };
    // Each verify attempt is two PLAN rounds: propose the call, then (seeing
    // the result) give a final answer so the tool-round loop terminates and
    // VERIFY actually runs on that attempt's outcome.
    const modelProvider = fakeModelProvider([
      [{ kind: "toolCall", call }, { kind: "done" }],
      [{ kind: "text", text: "attempt 1 result" }, { kind: "done" }],
      [{ kind: "toolCall", call }, { kind: "done" }],
      [{ kind: "text", text: "attempt 2 result" }, { kind: "done" }],
    ]);

    const loop = new AgentLoop({
      modelProvider,
      toolRegistry,
      approvalGate,
      channel,
      onEvent: (e) => events.push(e),
    });

    await loop.run();

    const verifications = events.filter((e) => e.kind === "VerificationResult");
    expect(verifications).toHaveLength(2);
    expect(verifications[0]).toMatchObject({ passed: false });
    expect(verifications[1]).toMatchObject({ passed: true });
  });
});
