import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";
import { ToolSafetyTier } from "../../src/base/tool-definition.js";
import { connectMcpEntry } from "../../src/config/mcp-client.js";
import type { McpToolEntry } from "../../src/config/types.js";
import { ToolSandbox } from "../../src/sandbox/tool-sandbox.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "../fixtures/mcp-echo-server.mjs");

const entry: McpToolEntry = {
  kind: "mcp",
  id: "echo",
  transport: "stdio",
  command: [process.execPath, fixturePath],
};

function findTool(connection: { tools: readonly { id: string }[] }, id: string) {
  const tool = connection.tools.find((t) => t.id === id);
  if (tool === undefined) throw new Error(`expected a discovered tool with id "${id}"`);
  return tool;
}

describe("connectMcpEntry", () => {
  it("discovers the server's tools, namespaces them, round-trips a call, and closes cleanly", async () => {
    const connection = await connectMcpEntry(entry);
    let tool!: ReturnType<typeof findTool>;
    try {
      expect(connection.tools).toHaveLength(2);
      tool = findTool(connection, "echo.echo");

      // Namespaced <entryId>.<serverToolName> (design doc §5), and floored
      // at the top tier unconditionally — no safetyTier field exists on an
      // mcp entry to override it (design doc §3).
      expect(tool.safetyTier).toBe(ToolSafetyTier.DangerousConfirmRequired);

      expect(tool.validate({}).valid).toBe(false);
      expect(tool.validate({ value: "hello" }).valid).toBe(true);

      const ctx = { sandbox: new ToolSandbox(), cancellation: new AbortController().signal, sessionId: "test" };
      const result = await tool.execute(ctx, { value: "hello" });
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("expected success");
      expect((result.output as { content: Array<{ text: string }> }).content[0]?.text).toBe("hello");
    } finally {
      await connection.close();
    }

    // Once closed, the underlying stdio child process is gone — a further
    // call must fail rather than silently hang or succeed.
    const ctx = { sandbox: new ToolSandbox(), cancellation: new AbortController().signal, sessionId: "test" };
    const result = await tool.execute(ctx, { value: "hello" });
    expect(result.success).toBe(false);
  }, 15_000);

  it("forwards {fromEnv}/{fromSecret}-resolved env vars to the spawned stdio process", async () => {
    process.env["TALON_TEST_MCP_ENV_VAR"] = "from-host-env";
    const connection = await connectMcpEntry(
      {
        ...entry,
        env: {
          FROM_ENV: { fromEnv: "TALON_TEST_MCP_ENV_VAR" },
          FROM_SECRET: { fromSecret: "TAVILY_API_KEY" },
          LITERAL: "a-literal-value",
        },
      },
      new Map([["TAVILY_API_KEY", "sk-test-key"]]),
    );
    try {
      const tool = findTool(connection, "echo.env_echo");
      const ctx = { sandbox: new ToolSandbox(), cancellation: new AbortController().signal, sessionId: "test" };

      const fromEnv = await tool.execute(ctx, { name: "FROM_ENV" });
      const fromSecret = await tool.execute(ctx, { name: "FROM_SECRET" });
      const literal = await tool.execute(ctx, { name: "LITERAL" });
      if (!fromEnv.success || !fromSecret.success || !literal.success) {
        throw new Error("expected every env_echo call to succeed");
      }
      expect((fromEnv.output as { content: Array<{ text: string }> }).content[0]?.text).toBe("from-host-env");
      expect((fromSecret.output as { content: Array<{ text: string }> }).content[0]?.text).toBe("sk-test-key");
      expect((literal.output as { content: Array<{ text: string }> }).content[0]?.text).toBe("a-literal-value");
    } finally {
      await connection.close();
      delete process.env["TALON_TEST_MCP_ENV_VAR"];
    }
  }, 15_000);
});
