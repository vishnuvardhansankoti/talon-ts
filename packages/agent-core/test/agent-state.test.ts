import { describe, expect, it } from "@jest/globals";
import { transition } from "../src/loop/agent-state.js";

describe("transition", () => {
  it("PRE_APPROVAL + APPROVAL_GRANTED -> ACT", () => {
    expect(transition({ kind: "PRE_APPROVAL" }, { type: "APPROVAL_GRANTED" })).toEqual({ kind: "ACT" });
  });

  it("PRE_APPROVAL + APPROVAL_DENIED_REPLAN -> PLAN", () => {
    expect(transition({ kind: "PRE_APPROVAL" }, { type: "APPROVAL_DENIED_REPLAN" })).toEqual({ kind: "PLAN" });
  });

  it("PRE_APPROVAL + APPROVAL_DENIED_ABORT -> COMPACT", () => {
    expect(transition({ kind: "PRE_APPROVAL" }, { type: "APPROVAL_DENIED_ABORT" })).toEqual({ kind: "COMPACT" });
  });

  it("VERIFY + VERIFY_PASSED -> LEARN", () => {
    expect(transition({ kind: "VERIFY" }, { type: "VERIFY_PASSED" })).toEqual({ kind: "LEARN" });
  });

  it("VERIFY + VERIFY_FAILED_RETRY -> PLAN", () => {
    expect(transition({ kind: "VERIFY" }, { type: "VERIFY_FAILED_RETRY" })).toEqual({ kind: "PLAN" });
  });

  it("VERIFY + VERIFY_FAILED_EXHAUSTED -> COMPACT", () => {
    expect(transition({ kind: "VERIFY" }, { type: "VERIFY_FAILED_EXHAUSTED" })).toEqual({ kind: "COMPACT" });
  });

  it("COMPACT + MORE_TURNS -> OBSERVE", () => {
    expect(transition({ kind: "COMPACT" }, { type: "MORE_TURNS" })).toEqual({ kind: "OBSERVE" });
  });

  it("COMPACT + SESSION_END stays COMPACT (terminal)", () => {
    expect(transition({ kind: "COMPACT" }, { type: "SESSION_END" })).toEqual({ kind: "COMPACT" });
  });

  it("throws on an event not valid for the current state", () => {
    expect(() => transition({ kind: "PRE_APPROVAL" }, { type: "VERIFY_PASSED" })).toThrow();
  });

  it("throws for states with no event-driven transition", () => {
    expect(() => transition({ kind: "OBSERVE" }, { type: "MORE_TURNS" })).toThrow();
  });
});
