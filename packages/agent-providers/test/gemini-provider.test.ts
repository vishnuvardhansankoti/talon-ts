import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { CloudTier } from "../src/contract/model-provider.js";
import { GeminiProvider } from "../src/gemini/gemini-provider.js";

describe("GeminiProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("checkHealth reports authMissing with no api key", async () => {
    const provider = new GeminiProvider(CloudTier.Small, "gemini-2.5-flash", "");
    expect(await provider.checkHealth()).toBe("authMissing");
  });

  it("checkHealth reports ready with an api key", async () => {
    const provider = new GeminiProvider(CloudTier.Small, "gemini-2.5-flash", "test-key");
    expect(await provider.checkHealth()).toBe("ready");
  });

  it("sends the api key as a query param and splits system turns into systemInstruction", async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new GeminiProvider(CloudTier.Small, "gemini-2.5-flash", "test-key");
    const chunks = [];
    for await (const chunk of provider.complete({
      messages: [
        { role: "system", content: "be concise" },
        { role: "user", content: "hi" },
      ],
      tools: [],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ kind: "done" }]);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toContain("models/gemini-2.5-flash:generateContent");
    expect(url.searchParams.get("key")).toBe("test-key");
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "be concise" }] });
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
  });

  it("parses a text response into a text chunk followed by done", async () => {
    globalThis.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hello there" }] } }] }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const provider = new GeminiProvider(CloudTier.Small, "gemini-2.5-flash", "test-key");
    const chunks = [];
    for await (const chunk of provider.complete({ messages: [{ role: "user", content: "hi" }], tools: [] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ kind: "text", text: "Hello there" }, { kind: "done" }]);
  });

  it("parses a functionCall part into a toolCall chunk with a synthesized id, then resolves a later tool-role message back to that function's name", async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ functionCall: { name: "fs.list_dir", args: { path: "." } } }] } }],
        }),
        { status: 200 },
      ),
    );

    const provider = new GeminiProvider(CloudTier.Small, "gemini-2.5-flash", "test-key");
    const chunks = [];
    for await (const chunk of provider.complete({ messages: [{ role: "user", content: "hi" }], tools: [] })) {
      chunks.push(chunk);
    }
    expect(chunks[0]).toMatchObject({ kind: "toolCall", call: { toolId: "fs.list_dir", input: { path: "." } } });
    const callId = (chunks[0] as { call: { id: string } }).call.id;

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    for await (const _ of provider.complete({
      messages: [{ role: "tool", content: '{"success":true}', toolCallId: callId }],
      tools: [],
    })) {
      // draining is enough
    }

    const [, secondInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    const secondBody = JSON.parse(secondInit.body as string);
    expect(secondBody.contents).toEqual([
      { role: "user", parts: [{ functionResponse: { name: "fs.list_dir", response: { result: '{"success":true}' } } }] },
    ]);
  });

  it("throws when the HTTP response is not ok", async () => {
    globalThis.fetch = jest.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const provider = new GeminiProvider(CloudTier.Small, "gemini-2.5-flash", "test-key");
    await expect(async () => {
      for await (const _ of provider.complete({ messages: [], tools: [] })) {
        // draining is enough to trigger the throw
      }
    }).rejects.toThrow();
  });
});
