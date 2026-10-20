import { describe, expect, it } from "@jest/globals";
import { AgentLoop } from "../src/loop/agent-loop.js";
import type { Channel, ChannelInput, ChannelOutput } from "../src/channel/channel.js";
import type { AgentEvent } from "../src/events/agent-event.js";
import type {
  ApprovalDecisionPort,
  ApprovalGatePort,
  CompletionChunk,
  CompletionRequest,
  MemoryPort,
  MemoryTurn,
  ModelProviderPort,
  ProposedToolCall,
  SkillsPort,
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

function fakeMemory(overrides: Partial<MemoryPort> = {}): MemoryPort {
  return {
    loadProfile: async () => "",
    recallEpisodic: async () => [],
    compact: async () => {},
    ...overrides,
  };
}

function fakeSkills(overrides: Partial<SkillsPort> = {}): SkillsPort {
  return {
    listCatalog: async () => [],
    activate: async () => [],
    hasMatchingSkill: async () => false,
    evaluateDraft: async () => ({ accepted: false, reason: "no-op fake" }),
    ...overrides,
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
      memory: fakeMemory(),
      skills: fakeSkills(),
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
      memory: fakeMemory(),
      skills: fakeSkills(),
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
      memory: fakeMemory(),
      skills: fakeSkills(),
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
      memory: fakeMemory(),
      skills: fakeSkills(),
      onEvent: (e) => events.push(e),
    });

    await loop.run();

    const verifications = events.filter((e) => e.kind === "VerificationResult");
    expect(verifications).toHaveLength(2);
    expect(verifications[0]).toMatchObject({ passed: false });
    expect(verifications[1]).toMatchObject({ passed: true });
  });

  it("recalls episodic memory and a loaded profile into context, and persists turns via memory.compact", async () => {
    const channel = fakeChannel([{ text: "what does talon use" }]);
    const events: AgentEvent[] = [];
    const toolRegistry: ToolRegistryPort = {
      listSchemas: () => [],
      resolveTier: () => "safeReadOnly",
      execute: async () => ({ success: true, output: null }),
    };
    const approvalGate: ApprovalGatePort = { request: async () => "approved" };

    let capturedRequest: CompletionRequest | undefined;
    const modelProvider: ModelProviderPort = {
      async *complete(request: CompletionRequest) {
        capturedRequest = request;
        yield { kind: "text", text: "noted" };
        yield { kind: "done" };
      },
    };

    const recallCalls: string[] = [];
    const compactCalls: { turns: readonly MemoryTurn[]; sessionEnding: boolean }[] = [];
    const memory = fakeMemory({
      loadProfile: async () => "User prefers concise answers.",
      recallEpisodic: async (query) => {
        recallCalls.push(query);
        return ["talon uses pnpm workspaces and turborepo"];
      },
      compact: async (turns, sessionEnding) => {
        compactCalls.push({ turns, sessionEnding });
      },
    });

    const loop = new AgentLoop({
      modelProvider,
      toolRegistry,
      approvalGate,
      channel,
      memory,
      skills: fakeSkills(),
      onEvent: (e) => events.push(e),
    });
    await loop.run();

    expect(recallCalls).toEqual(["what does talon use"]);

    // The profile is folded into the system message...
    expect(capturedRequest?.messages[0]?.role).toBe("system");
    expect(capturedRequest?.messages[0]?.content).toContain("User prefers concise answers.");
    // ...and the recalled entry is injected as its own system turn ahead of the user's message.
    expect(
      capturedRequest?.messages.some(
        (m) => m.role === "system" && m.content.includes("talon uses pnpm workspaces"),
      ),
    ).toBe(true);

    // One per-turn compact (sessionEnding: false) plus one at true session end.
    expect(compactCalls.some((c) => c.sessionEnding === false)).toBe(true);
    expect(compactCalls.at(-1)?.sessionEnding).toBe(true);

    // The real turn content reached memory.compact...
    const persistedContent = compactCalls.flatMap((c) => c.turns).map((t) => t.content);
    expect(persistedContent).toContain("what does talon use");
    // ...but the recalled-memory injection itself was never persisted back.
    expect(persistedContent.some((c) => c.includes("Relevant memory"))).toBe(false);
  });

  it("injects the catalog index and an activated skill's body into context", async () => {
    const channel = fakeChannel([{ text: "please run the tests" }]);
    const toolRegistry: ToolRegistryPort = {
      listSchemas: () => [],
      resolveTier: () => "safeReadOnly",
      execute: async () => ({ success: true, output: null }),
    };
    const approvalGate: ApprovalGatePort = { request: async () => "approved" };

    let capturedRequest: CompletionRequest | undefined;
    const modelProvider: ModelProviderPort = {
      async *complete(request: CompletionRequest) {
        capturedRequest = request;
        yield { kind: "text", text: "ok" };
        yield { kind: "done" };
      },
    };

    const activatedIds: string[] = [];
    const skills = fakeSkills({
      listCatalog: async () => [{ id: "skill.run_tests", triggerSummary: "Run the project's test suite" }],
      activate: async (ctx) => {
        activatedIds.push(...ctx.activeSkillIds);
        if (ctx.userIntentSummary.includes("tests")) {
          return [{ id: "skill.run_tests", body: "1. Run npm test." }];
        }
        return [];
      },
    });

    const loop = new AgentLoop({
      modelProvider,
      toolRegistry,
      approvalGate,
      channel,
      memory: fakeMemory(),
      skills,
      onEvent: () => {},
    });
    await loop.run();

    const systemContent = capturedRequest?.messages[0]?.content ?? "";
    expect(systemContent).toContain("skill.run_tests");
    expect(capturedRequest?.messages.some((m) => m.role === "system" && m.content.includes("Run npm test"))).toBe(
      true,
    );
  });

  it("fires SkillSynthesized for an eligible multi-tool-call turn", async () => {
    const channel = fakeChannel([{ text: "do a two-step task" }]);
    const events: AgentEvent[] = [];

    const toolRegistry: ToolRegistryPort = {
      listSchemas: () => [],
      resolveTier: () => "safeReadOnly",
      execute: async () => ({ success: true, output: "ok" }),
    };
    const approvalGate: ApprovalGatePort = { request: async () => "approved" };

    const callA: ProposedToolCall = { id: "call-a", toolId: "fs.read_file", input: { path: "a" } };
    const callB: ProposedToolCall = { id: "call-b", toolId: "shell.exec", input: { command: "ls" } };
    const draftTexts: string[] = [];
    const modelProvider = fakeModelProvider([
      [{ kind: "toolCall", call: callA }, { kind: "toolCall", call: callB }, { kind: "done" }],
      [{ kind: "text", text: "both steps done" }, { kind: "done" }],
      [{ kind: "text", text: "---\nid: skill.two_step\n---\nbody" }, { kind: "done" }],
    ]);

    const skills = fakeSkills({
      hasMatchingSkill: async () => false,
      evaluateDraft: async (rawDraftText) => {
        draftTexts.push(rawDraftText);
        return { accepted: true, skillId: "skill.two_step", reason: "confidence 0.9 meets threshold" };
      },
    });

    const loop = new AgentLoop({
      modelProvider,
      toolRegistry,
      approvalGate,
      channel,
      memory: fakeMemory(),
      skills,
      onEvent: (e) => events.push(e),
    });
    await loop.run();

    expect(draftTexts).toHaveLength(1);
    expect(draftTexts[0]).toContain("skill.two_step");
    expect(events).toContainEqual({
      kind: "SkillSynthesized",
      accepted: true,
      skillId: "skill.two_step",
      reason: "confidence 0.9 meets threshold",
    });
  });

  it("never triggers synthesis for a turn that used a dangerousConfirmRequired tool", async () => {
    const channel = fakeChannel([{ text: "do a risky two-step task" }]);
    const events: AgentEvent[] = [];

    const toolRegistry: ToolRegistryPort = {
      listSchemas: () => [],
      resolveTier: (toolId) => (toolId === "shell.exec" ? "dangerousConfirmRequired" : "safeReadOnly"),
      execute: async () => ({ success: true, output: "ok" }),
    };
    const approvalGate: ApprovalGatePort = { request: async () => "approved" }; // approves even the dangerous call

    const callA: ProposedToolCall = { id: "call-a", toolId: "fs.read_file", input: { path: "a" } };
    const callB: ProposedToolCall = { id: "call-b", toolId: "shell.exec", input: { command: "rm thing" } };
    const modelProvider = fakeModelProvider([
      [{ kind: "toolCall", call: callA }, { kind: "toolCall", call: callB }, { kind: "done" }],
      [{ kind: "text", text: "both steps done" }, { kind: "done" }],
    ]);

    let draftRequested = false;
    const skills = fakeSkills({
      evaluateDraft: async () => {
        draftRequested = true;
        return { accepted: true, reason: "should never be reached" };
      },
    });

    const loop = new AgentLoop({
      modelProvider,
      toolRegistry,
      approvalGate,
      channel,
      memory: fakeMemory(),
      skills,
      onEvent: (e) => events.push(e),
    });
    await loop.run();

    expect(draftRequested).toBe(false);
    expect(events.some((e) => e.kind === "SkillSynthesized")).toBe(false);
  });
});
