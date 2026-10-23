import { describe, expect, it } from "@jest/globals";
import type { AgentEvent } from "@talon/agent-core";
import { talon } from "@talon/grpc-contracts";
import { toServerMessage } from "../src/grpc-server.js";

describe("toServerMessage", () => {
  it("maps StateTransitioned", () => {
    const event: AgentEvent = { kind: "StateTransitioned", from: { kind: "OBSERVE" }, to: { kind: "PLAN" } };
    expect(toServerMessage(event)).toEqual(
      talon.ServerMessage.fromPartial({ agentEvent: { stateTransitioned: { from: "OBSERVE", to: "PLAN" } } }),
    );
  });

  it("maps ToolCallProposed, JSON-stringifying the call input", () => {
    const event: AgentEvent = {
      kind: "ToolCallProposed",
      call: { id: "call-1", toolId: "shell.exec", input: { command: "ls" } },
    };
    expect(toServerMessage(event)).toEqual(
      talon.ServerMessage.fromPartial({
        agentEvent: {
          toolCallProposed: { callId: "call-1", toolId: "shell.exec", inputJson: JSON.stringify({ command: "ls" }) },
        },
      }),
    );
  });

  it("maps ToolCallDelta", () => {
    const event: AgentEvent = { kind: "ToolCallDelta", partialJson: '{"comm' };
    expect(toServerMessage(event)).toEqual(
      talon.ServerMessage.fromPartial({ agentEvent: { toolCallDelta: { partialJson: '{"comm' } } }),
    );
  });

  it("maps a passing VerificationResult, defaulting the missing reason to an empty string", () => {
    const event: AgentEvent = { kind: "VerificationResult", passed: true };
    expect(toServerMessage(event)).toEqual(
      talon.ServerMessage.fromPartial({ agentEvent: { verificationResult: { passed: true, reason: "" } } }),
    );
  });

  it("maps a failing VerificationResult with a reason", () => {
    const event: AgentEvent = { kind: "VerificationResult", passed: false, reason: "tool X failed" };
    expect(toServerMessage(event)).toEqual(
      talon.ServerMessage.fromPartial({
        agentEvent: { verificationResult: { passed: false, reason: "tool X failed" } },
      }),
    );
  });

  it("maps an accepted SkillSynthesized with its skillId", () => {
    const event: AgentEvent = {
      kind: "SkillSynthesized",
      accepted: true,
      skillId: "skill.run_tests",
      reason: "confidence high enough",
    };
    expect(toServerMessage(event)).toEqual(
      talon.ServerMessage.fromPartial({
        agentEvent: {
          skillSynthesized: { accepted: true, skillId: "skill.run_tests", reason: "confidence high enough" },
        },
      }),
    );
  });

  it("maps a rejected SkillSynthesized, defaulting the missing skillId to an empty string", () => {
    const event: AgentEvent = { kind: "SkillSynthesized", accepted: false, reason: "confidence too low" };
    expect(toServerMessage(event)).toEqual(
      talon.ServerMessage.fromPartial({
        agentEvent: { skillSynthesized: { accepted: false, skillId: "", reason: "confidence too low" } },
      }),
    );
  });
});
