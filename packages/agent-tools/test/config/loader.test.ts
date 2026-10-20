import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { ToolConfigError } from "../../src/config/errors.js";
import { loadToolsFromYaml } from "../../src/config/loader.js";
import { ToolSandbox } from "../../src/sandbox/tool-sandbox.js";

const YAML_TEXT = `
tools:
  - kind: http
    id: weather.lookup
    description: Look up weather.
    allowedHosts: ["api.weather.example.com"]
    url: "https://api.weather.example.com/v1/current"
    query:
      city:
        fromInput: city
    inputSchema:
      type: object
      properties:
        city: { type: string }
      required: [city]
  - kind: exec
    id: repo.echo
    description: Echo a value.
    command: node
    args: ["-e", "process.stdout.write('ok')"]
    inputSchema:
      type: object
      properties: {}
`;

const INVALID_YAML_TEXT = `
tools:
  - kind: http
    id: bad.entry
    method: POST
    safetyTier: safeReadOnly
`;

describe("loadToolsFromYaml", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("parses real YAML text into the right ToolDefinition kinds, with no live connections to close", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "talon-tools-"));
    const filePath = path.join(dir, "tools.yaml");
    await writeFile(filePath, YAML_TEXT, "utf8");

    const handle = await loadToolsFromYaml(filePath, process.cwd());
    try {
      expect(handle.tools.map((t) => t.id).sort()).toEqual(["repo.echo", "weather.lookup"]);
    } finally {
      await expect(handle.close()).resolves.toBeUndefined();
    }
  });

  it("propagates a ToolConfigError for an invalid entry, naming the file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "talon-tools-"));
    const filePath = path.join(dir, "bad-tools.yaml");
    await writeFile(filePath, INVALID_YAML_TEXT, "utf8");

    await expect(loadToolsFromYaml(filePath, process.cwd())).rejects.toBeInstanceOf(ToolConfigError);
  });

  it("loads every *.yaml/*.yml fragment in a directory, ignoring unrelated files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "talon-tools-dir-"));
    await writeFile(
      path.join(dir, "a.yaml"),
      'tools:\n  - kind: exec\n    id: a.echo\n    description: a\n    command: node\n    args: []\n    inputSchema: { type: object, properties: {} }\n',
      "utf8",
    );
    await writeFile(
      path.join(dir, "b.yml"),
      'tools:\n  - kind: exec\n    id: b.echo\n    description: b\n    command: node\n    args: []\n    inputSchema: { type: object, properties: {} }\n',
      "utf8",
    );
    await writeFile(path.join(dir, "README.md"), "not yaml", "utf8");

    const handle = await loadToolsFromYaml(dir, process.cwd());
    try {
      expect(handle.tools.map((t) => t.id).sort()).toEqual(["a.echo", "b.echo"]);
    } finally {
      await handle.close();
    }
  });

  it("rejects an id declared in two different files within a directory, naming both", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "talon-tools-dir-dup-"));
    const fragment = 'tools:\n  - kind: exec\n    id: dup.echo\n    description: d\n    command: node\n    args: []\n    inputSchema: { type: object, properties: {} }\n';
    await writeFile(path.join(dir, "a.yaml"), fragment, "utf8");
    await writeFile(path.join(dir, "b.yaml"), fragment, "utf8");

    await expect(loadToolsFromYaml(dir, process.cwd())).rejects.toThrow(/duplicate tool id "dup.echo".*a\.yaml/);
  });

  it("threads a secretsPath through to http entries' {fromSecret} headers", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "talon-tools-secrets-"));
    const toolsPath = path.join(dir, "tools.yaml");
    const secretsPath = path.join(dir, "secrets.yaml");
    await writeFile(
      toolsPath,
      [
        "tools:",
        "  - kind: http",
        "    id: weather.lookup",
        "    description: weather",
        '    allowedHosts: ["api.weather.example.com"]',
        '    url: "https://api.weather.example.com/v1/current"',
        "    headers:",
        "      Authorization: { fromSecret: WEATHER_API_KEY, prefix: 'Bearer ' }",
        "    inputSchema: { type: object, properties: {} }",
      ].join("\n"),
      "utf8",
    );
    await writeFile(secretsPath, "WEATHER_API_KEY: sk-abc123\n", "utf8");

    const handle = await loadToolsFromYaml(toolsPath, process.cwd(), secretsPath);
    try {
      expect(handle.tools).toHaveLength(1);

      let capturedHeaders: Headers | undefined;
      jest.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        capturedHeaders = new Headers(init?.headers);
        return new Response("{}", { status: 200 });
      });

      const [tool] = handle.tools;
      if (tool === undefined) throw new Error("expected one tool");
      const ctx = { sandbox: new ToolSandbox(), cancellation: new AbortController().signal, sessionId: "test" };
      const result = await tool.execute(ctx, {});
      expect(result.success).toBe(true);
      expect(capturedHeaders?.get("authorization")).toBe("Bearer sk-abc123");
    } finally {
      await handle.close();
    }
  });
});
