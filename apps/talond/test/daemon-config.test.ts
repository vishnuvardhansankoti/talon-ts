import { afterEach, describe, expect, it } from "@jest/globals";
import path from "node:path";
import { resolveDaemonConfig } from "../src/daemon-config.js";

const ENV_KEYS = [
  "TALON_PROJECT_ROOT",
  "TALON_MODEL",
  "TALON_MODEL_KEEP_ALIVE",
  "TALON_TOOLS_CONFIG",
  "TALON_SECRETS_FILE",
  "TALON_SOCKET",
] as const;

describe("resolveDaemonConfig", () => {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("defaults projectRoot to cwd, model to qwen2.5:7b-instruct, ollamaKeepAlive to 30m, and socketPath to <projectRoot>/.talon/talond.sock", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const config = resolveDaemonConfig();
    expect(config.projectRoot).toBe(process.cwd());
    expect(config.model).toBe("qwen2.5:7b-instruct");
    expect(config.ollamaKeepAlive).toBe("30m");
    expect(config.socketPath).toBe(path.join(process.cwd(), ".talon", "talond.sock"));
    expect(config.toolsConfigPath).toBeUndefined();
    expect(config.secretsPath).toBeUndefined();
  });

  it("reads every TALON_* override when set", () => {
    process.env["TALON_PROJECT_ROOT"] = "/tmp/some-project";
    process.env["TALON_MODEL"] = "llama3.1:8b";
    process.env["TALON_MODEL_KEEP_ALIVE"] = "1h";
    process.env["TALON_SOCKET"] = "/tmp/custom.sock";
    process.env["TALON_TOOLS_CONFIG"] = "/tmp/tools.yaml";
    process.env["TALON_SECRETS_FILE"] = "/tmp/secrets.yaml";

    expect(resolveDaemonConfig()).toEqual({
      projectRoot: "/tmp/some-project",
      model: "llama3.1:8b",
      ollamaKeepAlive: "1h",
      socketPath: "/tmp/custom.sock",
      toolsConfigPath: "/tmp/tools.yaml",
      secretsPath: "/tmp/secrets.yaml",
    });
  });

  it("derives socketPath from TALON_PROJECT_ROOT when TALON_SOCKET is unset", () => {
    delete process.env["TALON_SOCKET"];
    process.env["TALON_PROJECT_ROOT"] = "/tmp/another-project";
    expect(resolveDaemonConfig().socketPath).toBe(path.join("/tmp/another-project", ".talon", "talond.sock"));
  });
});
