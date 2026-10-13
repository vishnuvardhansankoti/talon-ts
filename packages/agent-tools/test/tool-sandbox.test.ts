import { describe, expect, it } from "@jest/globals";
import { ToolSandbox } from "../src/sandbox/tool-sandbox.js";

describe("ToolSandbox", () => {
  it("captures stdout and a zero exit code for a successful command", async () => {
    const sandbox = new ToolSandbox();
    const result = await sandbox.exec("node", ["-e", "process.stdout.write('hello')"], { cwd: process.cwd() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
    expect(result.truncated).toBe(false);
  });

  it("reports a non-zero exit code without throwing", async () => {
    const sandbox = new ToolSandbox();
    const result = await sandbox.exec("node", ["-e", "process.exit(3)"], { cwd: process.cwd() });
    expect(result.exitCode).toBe(3);
  });

  it("truncates output past maxOutputBytes", async () => {
    const sandbox = new ToolSandbox();
    const result = await sandbox.exec(
      "node",
      ["-e", "process.stdout.write('x'.repeat(1000))"],
      { cwd: process.cwd(), maxOutputBytes: 10 },
    );
    expect(result.stdout).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("does not leak unlisted environment variables into the subprocess", async () => {
    const sandbox = new ToolSandbox();
    process.env["TALON_TEST_SECRET"] = "should-not-leak";
    try {
      const result = await sandbox.exec(
        "node",
        ["-e", "process.stdout.write(process.env.TALON_TEST_SECRET ?? 'absent')"],
        { cwd: process.cwd(), envAllowlist: ["PATH"] },
      );
      expect(result.stdout).toBe("absent");
    } finally {
      delete process.env["TALON_TEST_SECRET"];
    }
  });

  it("aborts on cancellation", async () => {
    const sandbox = new ToolSandbox();
    const controller = new AbortController();
    const promise = sandbox.exec("node", ["-e", "setTimeout(() => {}, 5000)"], {
      cwd: process.cwd(),
      cancellation: controller.signal,
    });
    controller.abort();
    const result = await promise;
    expect(result.exitCode).not.toBe(0);
  });
});
