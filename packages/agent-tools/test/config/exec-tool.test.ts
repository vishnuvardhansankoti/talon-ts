import { realpathSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { ConfigExecTool } from "../../src/config/exec-tool.js";
import type { ExecToolEntry } from "../../src/config/types.js";
import { ToolSandbox } from "../../src/sandbox/tool-sandbox.js";
import type { ToolExecutionContext } from "../../src/base/tool-definition.js";

function makeCtx(): ToolExecutionContext {
  return { sandbox: new ToolSandbox(), cancellation: new AbortController().signal, sessionId: "test" };
}

const baseEntry: ExecToolEntry = {
  kind: "exec",
  id: "echo.args",
  description: "echo argv back as JSON",
  inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
  command: "node",
  args: ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", { fromInput: "value" }],
};

describe("ConfigExecTool", () => {
  it("binds {fromInput} values into argv, never through a shell", async () => {
    const tool = new ConfigExecTool(baseEntry, process.cwd());
    const dangerous = "; touch /tmp/should-not-exist; echo pwned";

    const result = await tool.execute(makeCtx(), { value: dangerous });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");

    // The dangerous string must arrive as one opaque argv element — proof
    // it was never interpreted by a shell — not expanded/split/executed.
    const argv = JSON.parse((result.output as { stdout: string }).stdout) as string[];
    expect(argv).toEqual([dangerous]);
  });

  it("rejects input that fails the declared inputSchema", () => {
    const tool = new ConfigExecTool(baseEntry, process.cwd());
    expect(tool.validate({}).valid).toBe(false);
    expect(tool.validate({ value: "ok" }).valid).toBe(true);
  });

  it("uses the entry's cwd override when provided", async () => {
    const entry: ExecToolEntry = {
      ...baseEntry,
      args: ["-e", "process.stdout.write(process.cwd())"],
      cwd: "/tmp",
    };
    const tool = new ConfigExecTool(entry, process.cwd());
    const result = await tool.execute(makeCtx(), { value: "unused" });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect((result.output as { stdout: string }).stdout).toBe(realpathSync("/tmp"));
  });

  it("uses the entry's envAllowlist override", async () => {
    const entry: ExecToolEntry = {
      ...baseEntry,
      args: ["-e", "process.stdout.write(process.env.TALON_TEST_EXEC_VAR ?? 'absent')"],
      envAllowlist: ["PATH", "TALON_TEST_EXEC_VAR"],
    };
    process.env["TALON_TEST_EXEC_VAR"] = "present";
    try {
      const tool = new ConfigExecTool(entry, process.cwd());
      const result = await tool.execute(makeCtx(), { value: "unused" });
      expect(result.success).toBe(true);
      if (!result.success) throw new Error("expected success");
      expect((result.output as { stdout: string }).stdout).toBe("present");
    } finally {
      delete process.env["TALON_TEST_EXEC_VAR"];
    }
  });

  it("maps a non-zero exit code to SANDBOX_NONZERO_EXIT", async () => {
    const entry: ExecToolEntry = { ...baseEntry, args: ["-e", "process.exit(3)"] };
    const tool = new ConfigExecTool(entry, process.cwd());
    const result = await tool.execute(makeCtx(), { value: "unused" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.errorCode).toBe("SANDBOX_NONZERO_EXIT");
  });
});
