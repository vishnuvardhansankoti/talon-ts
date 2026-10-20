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

describe("connectMcpEntry", () => {
  it("discovers the server's tools, namespaces them, round-trips a call, and closes cleanly", async () => {
    const connection = await connectMcpEntry(entry);
    try {
      expect(connection.tools).toHaveLength(1);
      const [tool] = connection.tools;
      if (tool === undefined) throw new Error("expected one discovered tool");

      // Namespaced <entryId>.<serverToolName> (design doc §5), and floored
      // at the top tier unconditionally — no safetyTier field exists on an
      // mcp entry to override it (design doc §3).
      expect(tool.id).toBe("echo.echo");
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
    const [tool] = connection.tools;
    if (tool === undefined) throw new Error("expected one discovered tool");
    const ctx = { sandbox: new ToolSandbox(), cancellation: new AbortController().signal, sessionId: "test" };
    const result = await tool.execute(ctx, { value: "hello" });
    expect(result.success).toBe(false);
  }, 15_000);
});
