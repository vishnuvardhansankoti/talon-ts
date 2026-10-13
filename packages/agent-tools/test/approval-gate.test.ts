import { describe, expect, it } from "@jest/globals";
import { ApprovalGate, type ApprovalDecision, type ApprovalPrompter, type ProposedCall } from "../src/approval/approval-gate.js";
import { ToolSafetyTier } from "../src/base/tool-definition.js";

function countingPrompter(decision: ApprovalDecision): ApprovalPrompter & { calls: number } {
  return {
    calls: 0,
    async prompt() {
      this.calls += 1;
      return decision;
    },
  };
}

describe("ApprovalGate", () => {
  const call: ProposedCall = { toolId: "shell.exec", input: { command: "git status" } };

  it("prompts once and caches an approved heuristicSandboxed call", async () => {
    const prompter = countingPrompter("approved");
    const gate = new ApprovalGate(prompter);

    expect(await gate.request(call, ToolSafetyTier.HeuristicSandboxed)).toBe("approved");
    expect(await gate.request(call, ToolSafetyTier.HeuristicSandboxed)).toBe("approved");
    expect(prompter.calls).toBe(1);
  });

  it("does not cache a denied heuristicSandboxed call", async () => {
    const prompter = countingPrompter("denied");
    const gate = new ApprovalGate(prompter);

    expect(await gate.request(call, ToolSafetyTier.HeuristicSandboxed)).toBe("denied");
    expect(await gate.request(call, ToolSafetyTier.HeuristicSandboxed)).toBe("denied");
    expect(prompter.calls).toBe(2);
  });

  it("never caches dangerousConfirmRequired, even when approved", async () => {
    const prompter = countingPrompter("approved");
    const gate = new ApprovalGate(prompter);

    await gate.request(call, ToolSafetyTier.DangerousConfirmRequired);
    await gate.request(call, ToolSafetyTier.DangerousConfirmRequired);
    expect(prompter.calls).toBe(2);
  });

  it("distinguishes cache entries by argument hash", async () => {
    const prompter = countingPrompter("approved");
    const gate = new ApprovalGate(prompter);

    await gate.request(call, ToolSafetyTier.HeuristicSandboxed);
    await gate.request({ toolId: "shell.exec", input: { command: "npm test" } }, ToolSafetyTier.HeuristicSandboxed);
    expect(prompter.calls).toBe(2);
  });
});
