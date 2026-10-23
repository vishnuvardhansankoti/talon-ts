import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-native", () => ({ Platform: { OS: "ios", Version: "18.0" } }));

const mockFileState = { exists: true, text: async (): Promise<string> => "file contents" };
const mockDirectoryState = { exists: true, entries: [{ name: "a.txt" }, { name: "b.txt" }] };

jest.mock("expo-file-system", () => {
  class File {
    constructor(..._parts: unknown[]) {}
    get exists() {
      return mockFileState.exists;
    }
    text() {
      return mockFileState.text();
    }
  }
  class Directory {
    constructor(..._parts: unknown[]) {}
    get exists() {
      return mockDirectoryState.exists;
    }
    list() {
      return mockDirectoryState.entries;
    }
  }
  return { File, Directory, Paths: { document: new Directory() } };
});

import { createWebSearchTool, MobileToolRegistry } from "../src/agent/mobile-tools";

const ctx = { sessionId: "test", cancellation: new AbortController().signal };

describe("MobileToolRegistry", () => {
  it("lists exactly the three default mobile-safe tools, all safeReadOnly", () => {
    const registry = new MobileToolRegistry();
    const schemas = registry.listSchemas();
    expect(schemas.map((s) => s.id).sort()).toEqual(["device.info", "fs.list_dir", "fs.read_file"]);
    for (const id of ["device.info", "fs.read_file", "fs.list_dir"]) {
      expect(registry.resolveTier(id, {})).toBe("safeReadOnly");
    }
  });

  it("floors an unrecognized tool id at dangerousConfirmRequired, never a permissive default", () => {
    const registry = new MobileToolRegistry();
    expect(registry.resolveTier("shell.exec", {})).toBe("dangerousConfirmRequired");
  });

  it("reports TOOL_NOT_FOUND for an unregistered tool id — no shell.exec exists on mobile at all", async () => {
    const registry = new MobileToolRegistry();
    const result = await registry.execute("shell.exec", { command: "rm -rf /" }, ctx);
    expect(result).toEqual({
      success: false,
      errorCode: "TOOL_NOT_FOUND",
      errorMessage: 'no tool registered with id "shell.exec"',
    });
  });

  it("device.info returns platform/osVersion without touching the filesystem", async () => {
    const registry = new MobileToolRegistry();
    const result = await registry.execute("device.info", {}, ctx);
    expect(result).toEqual({ success: true, output: { platform: "ios", osVersion: "18.0" } });
  });

  describe("fs.read_file", () => {
    it("rejects a path that escapes the sandbox via '..' before ever touching the filesystem", async () => {
      const registry = new MobileToolRegistry();
      const result = await registry.execute("fs.read_file", { path: "../../etc/passwd" }, ctx);
      expect(result).toEqual({
        success: false,
        errorCode: "TOOL_VALIDATION_FAILED",
        errorMessage: "path escapes the sandboxed document directory",
      });
    });

    it("rejects an absolute path", async () => {
      const registry = new MobileToolRegistry();
      const result = await registry.execute("fs.read_file", { path: "/etc/passwd" }, ctx);
      expect(result.success).toBe(false);
    });

    it("rejects a missing or non-string path", async () => {
      const registry = new MobileToolRegistry();
      expect(await registry.execute("fs.read_file", {}, ctx)).toMatchObject({ errorCode: "TOOL_VALIDATION_FAILED" });
    });

    it("reads a file within the sandbox", async () => {
      mockFileState.exists = true;
      const registry = new MobileToolRegistry();
      const result = await registry.execute("fs.read_file", { path: "notes.txt" }, ctx);
      expect(result).toEqual({ success: true, output: "file contents" });
    });

    it("reports a clear error when the file doesn't exist", async () => {
      mockFileState.exists = false;
      const registry = new MobileToolRegistry();
      const result = await registry.execute("fs.read_file", { path: "missing.txt" }, ctx);
      expect(result).toEqual({ success: false, errorCode: "TOOL_EXECUTION_FAILED", errorMessage: "file does not exist" });
      mockFileState.exists = true;
    });
  });

  describe("fs.list_dir", () => {
    it("rejects a path that escapes the sandbox", async () => {
      const registry = new MobileToolRegistry();
      const result = await registry.execute("fs.list_dir", { path: "../.." }, ctx);
      expect(result.success).toBe(false);
    });

    it("lists entry names within the sandbox", async () => {
      mockDirectoryState.exists = true;
      const registry = new MobileToolRegistry();
      const result = await registry.execute("fs.list_dir", { path: "." }, ctx);
      expect(result).toEqual({ success: true, output: ["a.txt", "b.txt"] });
    });
  });
});

describe("createWebSearchTool", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("is heuristicSandboxed, not safeReadOnly — it sends the query to a third party", () => {
    expect(createWebSearchTool("tvly-fake").safetyTier).toBe("heuristicSandboxed");
  });

  it("rejects a missing or empty query before ever calling fetch", async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const tool = createWebSearchTool("tvly-fake");

    expect(await tool.execute({})).toMatchObject({ errorCode: "TOOL_VALIDATION_FAILED" });
    expect(await tool.execute({ query: "  " })).toMatchObject({ errorCode: "TOOL_VALIDATION_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to Tavily's REST /search with a Bearer auth header, returning answer + trimmed results", async () => {
    const fetchMock = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            answer: "It's sunny.",
            results: [{ title: "Weather", url: "https://example.com/weather", content: "Sunny, 72F", score: 0.9, extra: "dropped" }],
          }),
          { status: 200 },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const tool = createWebSearchTool("tvly-fake-key");
    const result = await tool.execute({ query: "weather today" });

    expect(result).toEqual({
      success: true,
      output: { answer: "It's sunny.", results: [{ title: "Weather", url: "https://example.com/weather", content: "Sunny, 72F" }] },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer tvly-fake-key");
    expect(JSON.parse(init.body as string)).toEqual({ query: "weather today" });
  });

  it("omits 'answer' from output when Tavily doesn't return one", async () => {
    globalThis.fetch = jest.fn(
      async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await createWebSearchTool("tvly-fake").execute({ query: "x" });
    expect(result).toEqual({ success: true, output: { results: [] } });
  });

  it("reports a clear error on a non-2xx response", async () => {
    globalThis.fetch = jest.fn(async () => new Response("", { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch;

    const result = await createWebSearchTool("tvly-bad-key").execute({ query: "x" });
    expect(result).toEqual({
      success: false,
      errorCode: "TOOL_EXECUTION_FAILED",
      errorMessage: "tavily search failed: 401 Unauthorized",
    });
  });

  it("reports a clear error when fetch itself throws (e.g. offline)", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("Network request failed");
    }) as unknown as typeof fetch;

    const result = await createWebSearchTool("tvly-fake").execute({ query: "x" });
    expect(result).toEqual({ success: false, errorCode: "TOOL_EXECUTION_FAILED", errorMessage: "Network request failed" });
  });
});
