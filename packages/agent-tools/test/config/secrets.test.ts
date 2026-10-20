import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import { ToolConfigError } from "../../src/config/errors.js";
import { loadSecretsFile } from "../../src/config/secrets.js";

async function writeTemp(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "talon-secrets-"));
  const filePath = path.join(dir, "secrets.yaml");
  await writeFile(filePath, contents, "utf8");
  return filePath;
}

describe("loadSecretsFile", () => {
  it("loads a flat mapping of name to string value", async () => {
    const filePath = await writeTemp('WEATHER_API_KEY: "sk-abc123"\nSUPPORT_API_KEY: "sk-def456"\n');
    const secrets = await loadSecretsFile(filePath);
    expect(secrets.get("WEATHER_API_KEY")).toBe("sk-abc123");
    expect(secrets.get("SUPPORT_API_KEY")).toBe("sk-def456");
  });

  it("rejects a non-string value", async () => {
    const filePath = await writeTemp("WEATHER_API_KEY: 12345\n");
    await expect(loadSecretsFile(filePath)).rejects.toBeInstanceOf(ToolConfigError);
  });

  it("rejects a root document that isn't a flat mapping", async () => {
    const filePath = await writeTemp("- one\n- two\n");
    await expect(loadSecretsFile(filePath)).rejects.toBeInstanceOf(ToolConfigError);
  });
});
