import { afterEach, describe, expect, it } from "@jest/globals";
import path from "node:path";
import { resolveCliConfig } from "../src/cli-config.js";

const ENV_KEYS = ["TALON_PROJECT_ROOT", "TALON_MODEL", "TALON_TOOLS_CONFIG", "TALON_SECRETS_FILE", "TALON_SOCKET"] as const;

describe("resolveCliConfig", () => {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("defaults projectRoot to cwd, socketPath to <projectRoot>/.talon/talond.sock, and address to unix://<socketPath>", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const config = resolveCliConfig();
    const expectedSocketPath = path.join(process.cwd(), ".talon", "talond.sock");
    expect(config.projectRoot).toBe(process.cwd());
    expect(config.socketPath).toBe(expectedSocketPath);
    expect(config.address).toBe(`unix://${expectedSocketPath}`);
    expect(config.model).toBeUndefined();
    expect(config.toolsConfigPath).toBeUndefined();
    expect(config.secretsPath).toBeUndefined();
  });

  it("reads every TALON_* override when set", () => {
    process.env["TALON_PROJECT_ROOT"] = "/tmp/some-project";
    process.env["TALON_MODEL"] = "llama3.1:8b";
    process.env["TALON_SOCKET"] = "/tmp/custom.sock";
    process.env["TALON_TOOLS_CONFIG"] = "/tmp/tools.yaml";
    process.env["TALON_SECRETS_FILE"] = "/tmp/secrets.yaml";

    expect(resolveCliConfig()).toEqual({
      projectRoot: "/tmp/some-project",
      socketPath: "/tmp/custom.sock",
      address: "unix:///tmp/custom.sock",
      model: "llama3.1:8b",
      toolsConfigPath: "/tmp/tools.yaml",
      secretsPath: "/tmp/secrets.yaml",
    });
  });

  it("derives socketPath (and address) from TALON_PROJECT_ROOT when TALON_SOCKET is unset", () => {
    delete process.env["TALON_SOCKET"];
    process.env["TALON_PROJECT_ROOT"] = "/tmp/another-project";
    const config = resolveCliConfig();
    const expectedSocketPath = path.join("/tmp/another-project", ".talon", "talond.sock");
    expect(config.socketPath).toBe(expectedSocketPath);
    expect(config.address).toBe(`unix://${expectedSocketPath}`);
  });
});
