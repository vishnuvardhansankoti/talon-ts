import { describe, expect, it } from "@jest/globals";
import { ToolConfigError } from "../../src/config/errors.js";
import { parseToolConfigFile } from "../../src/config/parse.js";

const validHttp = {
  kind: "http",
  id: "weather.lookup",
  description: "Look up weather.",
  inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  allowedHosts: ["api.weather.example.com"],
  url: "https://api.weather.example.com/v1/current",
  query: { city: { fromInput: "city" } },
};

const validExec = {
  kind: "exec",
  id: "repo.lint_diff",
  description: "Lint a file.",
  inputSchema: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] },
  command: "npm",
  args: ["run", "lint", "--", { fromInput: "filePath" }],
};

const validMcpStdio = {
  kind: "mcp",
  id: "figma",
  transport: "stdio",
  command: ["npx", "-y", "@figma/mcp-server"],
};

describe("parseToolConfigFile", () => {
  it("parses one entry of each kind", () => {
    const entries = parseToolConfigFile({ tools: [validHttp, validExec, validMcpStdio] }, "tools.yaml");
    expect(entries.map((e) => e.kind)).toEqual(["http", "exec", "mcp"]);
  });

  it("defaults http method to GET and floors at heuristicSandboxed", () => {
    const [entry] = parseToolConfigFile({ tools: [validHttp] }, "tools.yaml");
    expect(entry).toMatchObject({ method: "GET" });
  });

  it("rejects an http entry whose declared safetyTier is below its floor", () => {
    const entry = { ...validHttp, method: "POST", safetyTier: "safeReadOnly" };
    expect(() => parseToolConfigFile({ tools: [entry] }, "tools.yaml")).toThrow(ToolConfigError);
  });

  it("allows an entry to raise its tier above the floor", () => {
    const entry = { ...validExec, safetyTier: "dangerousConfirmRequired" };
    const [parsed] = parseToolConfigFile({ tools: [entry] }, "tools.yaml");
    expect(parsed.safetyTier).toBe("dangerousConfirmRequired");
  });

  it("rejects a duplicate id within the same file", () => {
    expect(() => parseToolConfigFile({ tools: [validExec, validExec] }, "tools.yaml")).toThrow(/duplicate tool id/);
  });

  it("rejects an unknown kind", () => {
    expect(() => parseToolConfigFile({ tools: [{ kind: "ftp", id: "x" }] }, "tools.yaml")).toThrow(
      /unknown "kind"/,
    );
  });

  it("rejects a root document without a tools array", () => {
    expect(() => parseToolConfigFile({}, "tools.yaml")).toThrow(ToolConfigError);
  });

  it("rejects an mcp stdio entry missing command", () => {
    expect(() => parseToolConfigFile({ tools: [{ kind: "mcp", id: "figma", transport: "stdio" }] }, "tools.yaml")).toThrow(
      /command/,
    );
  });

  it("parses an mcp stdio entry's env as a mix of literal/fromEnv/fromSecret bindings", () => {
    const entry = {
      ...validMcpStdio,
      env: { TAVILY_API_KEY: { fromSecret: "TAVILY_API_KEY" }, MODE: "search", RAW: { fromEnv: "SOME_VAR" } },
    };
    const [parsed] = parseToolConfigFile({ tools: [entry] }, "tools.yaml");
    expect(parsed).toMatchObject({
      env: { TAVILY_API_KEY: { fromSecret: "TAVILY_API_KEY" }, MODE: "search", RAW: { fromEnv: "SOME_VAR" } },
    });
  });

  it("rejects an mcp stdio entry whose env is not an object", () => {
    expect(() => parseToolConfigFile({ tools: [{ ...validMcpStdio, env: "nope" }] }, "tools.yaml")).toThrow(/"env"/);
  });

  it("rejects env on an mcp http entry", () => {
    const entry = { kind: "mcp", id: "linear", transport: "http", url: "https://mcp.linear.app/mcp", env: {} };
    expect(() => parseToolConfigFile({ tools: [entry] }, "tools.yaml")).toThrow(/"env" is only valid for transport "stdio"/);
  });

  it("names the offending entry's file and index in the error message", () => {
    try {
      parseToolConfigFile({ tools: [validHttp, { kind: "bogus" }] }, "tools.yaml");
      throw new Error("expected parseToolConfigFile to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolConfigError);
      expect((error as Error).message).toContain("tools.yaml, entry 1");
    }
  });
});
