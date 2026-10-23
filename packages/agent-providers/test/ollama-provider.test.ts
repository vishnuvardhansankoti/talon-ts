import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { ReadableStream } from "node:stream/web";
import { OllamaProvider } from "../src/ollama/ollama-provider.js";

function ndjsonResponse(lines: string[], ok = true): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream as unknown as BodyInit, { status: ok ? 200 : 500 });
}

describe("OllamaProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("checkHealth reports ready when /api/tags responds ok", async () => {
    globalThis.fetch = jest.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const provider = new OllamaProvider("qwen2.5:7b-instruct");
    expect(await provider.checkHealth()).toBe("ready");
  });

  it("checkHealth reports daemonUnreachable when fetch throws", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const provider = new OllamaProvider("qwen2.5:7b-instruct");
    expect(await provider.checkHealth()).toBe("daemonUnreachable");
  });

  it("parses streamed text deltas into text chunks", async () => {
    globalThis.fetch = jest.fn(async () =>
      ndjsonResponse([
        '{"message":{"role":"assistant","content":"Hello"},"done":false}',
        '{"message":{"role":"assistant","content":" world"},"done":false}',
        '{"message":{"role":"assistant","content":""},"done":true}',
      ]),
    ) as unknown as typeof fetch;

    const provider = new OllamaProvider("qwen2.5:7b-instruct");
    const chunks = [];
    for await (const chunk of provider.complete({ messages: [{ role: "user", content: "hi" }], tools: [] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { kind: "text", text: "Hello" },
      { kind: "text", text: " world" },
      { kind: "done" },
    ]);
  });

  it("parses a streamed tool call, using Ollama's own call id", async () => {
    globalThis.fetch = jest.fn(async () =>
      ndjsonResponse([
        '{"message":{"role":"assistant","content":"","tool_calls":[{"id":"call_abc","function":{"name":"fs.list_dir","arguments":{"path":"."}}}]},"done":false}',
        '{"message":{"role":"assistant","content":""},"done":true}',
      ]),
    ) as unknown as typeof fetch;

    const provider = new OllamaProvider("qwen2.5:7b-instruct");
    const chunks = [];
    for await (const chunk of provider.complete({ messages: [{ role: "user", content: "hi" }], tools: [] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { kind: "toolCall", call: { id: "call_abc", toolId: "fs.list_dir", input: { path: "." } } },
      { kind: "done" },
    ]);
  });

  it("sends keep_alive, defaulting to 30m", async () => {
    const fetchMock = jest.fn(async () => ndjsonResponse(['{"message":{"role":"assistant","content":""},"done":true}']));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OllamaProvider("qwen2.5:7b-instruct");
    for await (const _ of provider.complete({ messages: [], tools: [] })) {
      // draining is enough
    }

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ keep_alive: "30m" });
  });

  it("sends a configured keep_alive instead of the default", async () => {
    const fetchMock = jest.fn(async () => ndjsonResponse(['{"message":{"role":"assistant","content":""},"done":true}']));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OllamaProvider("qwen2.5:7b-instruct", undefined, "1h");
    for await (const _ of provider.complete({ messages: [], tools: [] })) {
      // draining is enough
    }

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ keep_alive: "1h" });
  });

  it("throws when the HTTP response is not ok", async () => {
    globalThis.fetch = jest.fn(async () => ndjsonResponse([], false)) as unknown as typeof fetch;
    const provider = new OllamaProvider("qwen2.5:7b-instruct");
    await expect(async () => {
      for await (const _ of provider.complete({ messages: [], tools: [] })) {
        // draining is enough to trigger the throw
      }
    }).rejects.toThrow();
  });
});
