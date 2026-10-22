import { describe, expect, it, jest } from "@jest/globals";
import type { ApprovalDecisionPort } from "@talon/agent-core";

jest.mock("react-native", () => ({ Platform: { OS: "ios", Version: "18.0" } }));
jest.mock("expo-file-system", () => ({
  File: class {},
  Directory: class {},
  Paths: { document: {} },
}));
jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: async () => false,
  isEnrolledAsync: async () => false,
  authenticateAsync: async () => ({ success: false }),
}));

import { AgentSession } from "../src/agent/agent-session";

function flushMicrotasks(times = 10): Promise<void> {
  return new Promise((resolve) => {
    let remaining = times;
    const tick = (): void => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      setTimeout(tick, 0);
    };
    tick();
  });
}

describe("AgentSession", () => {
  // Deliberately never reads globalThis.fetch to snapshot/restore it: under
  // jest-expo, `fetch` is a lazily-resolving Proxy getter (Expo's "winter"
  // runtime polyfill) — merely reading it kicks off an async native-module
  // resolution that logs a warning after this file's tests have already
  // finished, which Jest treats as a failure ("Cannot log after tests are
  // done"). Each test file gets its own fresh global environment, and this
  // is the only file in this project that touches fetch, so there's
  // nothing real to restore.

  it("reports a model-provider failure via onError, then reports (without retrying the network call) that the session has ended on the next sendMessage", async () => {
    const fetchMock = jest.fn(async () => new Response("", { status: 400 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const onOutput = jest.fn();
    const onEvent = jest.fn();
    const onError = jest.fn();
    const requestInlineApproval = jest.fn<() => Promise<ApprovalDecisionPort>>();

    const session = new AgentSession("fake-api-key", { onOutput, onEvent, onError, requestInlineApproval });
    session.start();

    session.sendMessage("hello");
    await flushMicrotasks(30);

    expect(onError).toHaveBeenCalledTimes(1);
    const firstError = onError.mock.calls[0]?.[0] as Error;
    expect(firstError.message).toContain("gemini generateContent failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    session.sendMessage("are you still there");
    await flushMicrotasks(5);

    expect(onError).toHaveBeenCalledTimes(2);
    const secondError = onError.mock.calls[1]?.[0] as Error;
    expect(secondError.message).toContain("session has ended");
    expect(fetchMock).toHaveBeenCalledTimes(1); // never retried — the loop is dead, not retrying
  });

  it("start() is idempotent — calling it twice doesn't double-fire the loop", async () => {
    const fetchMock = jest.fn(async () => new Response("", { status: 400 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const onError = jest.fn();

    const session = new AgentSession("fake-api-key", {
      onOutput: jest.fn(),
      onError,
      requestInlineApproval: jest.fn<() => Promise<ApprovalDecisionPort>>(),
    });
    session.start();
    session.start();

    session.sendMessage("hello");
    await flushMicrotasks(30);

    expect(onError).toHaveBeenCalledTimes(1);
  });
});
