import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { ToolExecutionContext } from "../../src/base/tool-definition.js";
import { ConfigHttpTool } from "../../src/config/http-tool.js";
import type { HttpToolEntry } from "../../src/config/types.js";
import { ToolSandbox } from "../../src/sandbox/tool-sandbox.js";

const ENV_VAR = "TALON_TEST_HTTP_KEY";

function makeCtx(): ToolExecutionContext {
  return { sandbox: new ToolSandbox(), cancellation: new AbortController().signal, sessionId: "test" };
}

const entry: HttpToolEntry = {
  kind: "http",
  id: "weather.lookup",
  description: "look up weather",
  inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  allowedHosts: ["api.weather.example.com"],
  method: "GET",
  url: "https://api.weather.example.com/v1/current",
  query: { city: { fromInput: "city" } },
  headers: { Authorization: { fromEnv: ENV_VAR, prefix: "Bearer " } },
};

describe("ConfigHttpTool", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env[ENV_VAR];
  });

  it("builds the request from {fromInput}/{fromEnv} templates and succeeds on 2xx", async () => {
    process.env[ENV_VAR] = "secret";
    let capturedUrl = "";
    let capturedHeaders: Headers | undefined;
    jest.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ tempC: 21 }), { status: 200 });
    });

    const tool = new ConfigHttpTool(entry);
    const result = await tool.execute(makeCtx(), { city: "Austin" });

    expect(result.success).toBe(true);
    expect(capturedUrl).toBe("https://api.weather.example.com/v1/current?city=Austin");
    expect(capturedHeaders?.get("authorization")).toBe("Bearer secret");
  });

  it("never puts the resolved secret value anywhere in the entry itself", () => {
    // The YAML entry carries only the env var's *name* — resolution happens
    // at call time, never baked into the config.
    expect(JSON.stringify(entry)).not.toContain("Bearer secret");
    expect(JSON.stringify(entry)).toContain(ENV_VAR);
  });

  it("maps a non-2xx response to CONFIG_HTTP_NON_2XX", async () => {
    process.env[ENV_VAR] = "secret";
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("not found", { status: 404 }));

    const tool = new ConfigHttpTool(entry);
    const result = await tool.execute(makeCtx(), { city: "Austin" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorCode).toBe("CONFIG_HTTP_NON_2XX");
  });

  it("rejects a host outside allowedHosts before making any request", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    process.env[ENV_VAR] = "secret";
    const badEntry: HttpToolEntry = { ...entry, url: "https://evil.example.com/v1/current" };

    const tool = new ConfigHttpTool(badEntry);
    const result = await tool.execute(makeCtx(), { city: "Austin" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorCode).toBe("CONFIG_HTTP_REQUEST_FAILED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails with a clear error when the referenced env var is unset", async () => {
    const tool = new ConfigHttpTool(entry);
    const result = await tool.execute(makeCtx(), { city: "Austin" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorMessage).toContain(ENV_VAR);
  });

  it("rejects input that fails the declared inputSchema", () => {
    const tool = new ConfigHttpTool(entry);
    expect(tool.validate({}).valid).toBe(false);
    expect(tool.validate({ city: "Austin" }).valid).toBe(true);
  });

  it("resolves a {fromSecret} header from the secrets map passed to the constructor", async () => {
    let capturedHeaders: Headers | undefined;
    jest.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response("{}", { status: 200 });
    });

    const secretEntry: HttpToolEntry = {
      ...entry,
      headers: { Authorization: { fromSecret: "WEATHER_API_KEY", prefix: "Bearer " } },
    };
    const secrets = new Map([["WEATHER_API_KEY", "sk-abc123"]]);
    const tool = new ConfigHttpTool(secretEntry, secrets);

    const result = await tool.execute(makeCtx(), { city: "Austin" });
    expect(result.success).toBe(true);
    expect(capturedHeaders?.get("authorization")).toBe("Bearer sk-abc123");
  });
});
