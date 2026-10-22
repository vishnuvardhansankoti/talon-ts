import { describe, expect, it } from "@jest/globals";
import { talon } from "@talon/grpc-contracts";
import { toAgentEventPayload } from "../src/main/event-mapping.js";

describe("toAgentEventPayload", () => {
  it("maps stateTransitioned", () => {
    const event = talon.AgentEvent.fromPartial({ stateTransitioned: { from: "OBSERVE", to: "PLAN" } });
    expect(toAgentEventPayload(event)).toEqual({ kind: "stateTransitioned", from: "OBSERVE", to: "PLAN" });
  });

  it("maps verificationResult, omitting reason when the proto default (empty string) is falsy", () => {
    const event = talon.AgentEvent.fromPartial({ verificationResult: { passed: true } });
    expect(toAgentEventPayload(event)).toEqual({ kind: "verificationResult", passed: true });
  });

  it("maps verificationResult with a reason when the tool call failed", () => {
    const event = talon.AgentEvent.fromPartial({ verificationResult: { passed: false, reason: "tool X failed" } });
    expect(toAgentEventPayload(event)).toEqual({ kind: "verificationResult", passed: false, reason: "tool X failed" });
  });

  it("maps skillSynthesized, omitting skillId when a draft was rejected", () => {
    const event = talon.AgentEvent.fromPartial({ skillSynthesized: { accepted: false, reason: "confidence too low" } });
    expect(toAgentEventPayload(event)).toEqual({ kind: "skillSynthesized", accepted: false, reason: "confidence too low" });
  });

  it("maps skillSynthesized with a skillId when a draft was accepted", () => {
    const event = talon.AgentEvent.fromPartial({
      skillSynthesized: { accepted: true, skillId: "skill.run_tests", reason: "" },
    });
    expect(toAgentEventPayload(event)).toEqual({
      kind: "skillSynthesized",
      accepted: true,
      skillId: "skill.run_tests",
    });
  });

  it("returns undefined for variants this renderer doesn't surface (toolCallProposed/toolCallDelta)", () => {
    const proposed = talon.AgentEvent.fromPartial({
      toolCallProposed: { callId: "c1", toolId: "fs.read_file", inputJson: "{}" },
    });
    expect(toAgentEventPayload(proposed)).toBeUndefined();

    const delta = talon.AgentEvent.fromPartial({ toolCallDelta: { partialJson: "{" } });
    expect(toAgentEventPayload(delta)).toBeUndefined();
  });
});
