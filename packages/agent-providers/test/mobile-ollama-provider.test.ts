import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { MobileOllamaProvider } from "../src/ollama/mobile-ollama-provider.js";

describe("MobileOllamaProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("checkHealth reports ready when /api/tags responds ok", async () => {
    globalThis.fetch = jest.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const provider = new MobileOllamaProvider("qwen2.5:7b-instruct", new URL("http://192.168.1.50:11434"));
    expect(await provider.checkHealth()).toBe("ready");
  });

  it("checkHealth reports daemonUnreachable when fetch throws", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const provider = new MobileOllamaProvider("qwen2.5:7b-instruct", new URL("http://192.168.1.50:11434"));
    expect(await provider.checkHealth()).toBe("daemonUnreachable");
  });

  it("requests stream:false and a fixed 30m keep_alive, parsing the single non-streamed response into a text chunk + done", async () => {
    const fetchMock = jest.fn(
      async () => new Response(JSON.stringify({ message: { role: "assistant", content: "Hello world" } }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new MobileOllamaProvider("qwen2.5:7b-instruct", new URL("http://192.168.1.50:11434"));
    const chunks = [];
    for await (const chunk of provider.complete({ messages: [{ role: "user", content: "hi" }], tools: [] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ kind: "text", text: "Hello world" }, { kind: "done" }]);
    const [, requestInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(requestInit.body as string)).toMatchObject({ stream: false, keep_alive: "30m" });
  });

  it("parses a tool call from the single response, minting an id via globalThis.crypto when Ollama omits one", async () => {
    globalThis.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{ function: { name: "fs.list_dir", arguments: { path: "." } } }],
            },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const provider = new MobileOllamaProvider("qwen2.5:7b-instruct", new URL("http://192.168.1.50:11434"));
    const chunks = [];
    for await (const chunk of provider.complete({ messages: [{ role: "user", content: "hi" }], tools: [] })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    const [toolCallChunk, doneChunk] = chunks;
    expect(toolCallChunk).toMatchObject({ kind: "toolCall", call: { toolId: "fs.list_dir", input: { path: "." } } });
    expect(doneChunk).toEqual({ kind: "done" });
  });

  it("throws when the HTTP response is not ok", async () => {
    globalThis.fetch = jest.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const provider = new MobileOllamaProvider("qwen2.5:7b-instruct", new URL("http://192.168.1.50:11434"));
    await expect(async () => {
      for await (const _ of provider.complete({ messages: [], tools: [] })) {
        // draining is enough to trigger the throw
      }
    }).rejects.toThrow();
  });
});
