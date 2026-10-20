import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { ToolSandbox } from "../../src/sandbox/tool-sandbox.js";

function mockFetchSequence(responses: Array<() => Response>): jest.SpiedFunction<typeof fetch> {
  let call = 0;
  return jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const make = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return make();
  });
}

describe("ToolSandbox.fetch", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects a literal IP host even when listed in allowedHosts, without any network call", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const sandbox = new ToolSandbox();
    await expect(
      sandbox.fetch(
        { method: "GET", url: "http://169.254.169.254/latest/meta-data" },
        { allowedHosts: ["169.254.169.254"] },
      ),
    ).rejects.toThrow(/blocked/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects "localhost" even when listed in allowedHosts', async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const sandbox = new ToolSandbox();
    await expect(
      sandbox.fetch({ method: "GET", url: "http://localhost:9999/" }, { allowedHosts: ["localhost"] }),
    ).rejects.toThrow(/blocked/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a host not present in allowedHosts", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const sandbox = new ToolSandbox();
    await expect(
      sandbox.fetch({ method: "GET", url: "https://evil.example.com/" }, { allowedHosts: ["api.example.com"] }),
    ).rejects.toThrow(/not in the configured allowedHosts/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("succeeds for an allowed host", async () => {
    const fetchMock = mockFetchSequence([() => new Response("hello", { status: 200 })]);
    const sandbox = new ToolSandbox();
    const result = await sandbox.fetch(
      { method: "GET", url: "https://api.example.com/v1/search" },
      { allowedHosts: ["api.example.com"] },
    );
    expect(result).toEqual({ status: 200, body: "hello", truncated: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to an allowed host", async () => {
    const fetchMock = mockFetchSequence([
      () => new Response(null, { status: 302, headers: { Location: "https://api.example.com/v2/search" } }),
      () => new Response("final", { status: 200 }),
    ]);
    const sandbox = new ToolSandbox();
    const result = await sandbox.fetch(
      { method: "GET", url: "https://api.example.com/v1/search" },
      { allowedHosts: ["api.example.com"] },
    );
    expect(result.body).toBe("final");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a redirect hop to a host outside allowedHosts, without following it", async () => {
    const fetchMock = mockFetchSequence([
      () => new Response(null, { status: 302, headers: { Location: "https://evil.example.com/steal" } }),
    ]);
    const sandbox = new ToolSandbox();
    await expect(
      sandbox.fetch({ method: "GET", url: "https://api.example.com/v1/search" }, { allowedHosts: ["api.example.com"] }),
    ).rejects.toThrow(/not in the configured allowedHosts/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("truncates a response body past maxResponseBytes", async () => {
    mockFetchSequence([() => new Response("x".repeat(1000), { status: 200 })]);
    const sandbox = new ToolSandbox();
    const result = await sandbox.fetch(
      { method: "GET", url: "https://api.example.com/v1/search" },
      { allowedHosts: ["api.example.com"], maxResponseBytes: 10 },
    );
    expect(result.body).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("aborts once the timeout elapses", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const sandbox = new ToolSandbox();
    await expect(
      sandbox.fetch(
        { method: "GET", url: "https://api.example.com/v1/search" },
        { allowedHosts: ["api.example.com"], timeoutMs: 20 },
      ),
    ).rejects.toThrow();
  });
});
