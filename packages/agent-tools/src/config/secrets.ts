import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { ToolConfigError } from "./errors.js";

/**
 * A dedicated secrets store, for cases where `{fromEnv}` is awkward (e.g.
 * many `http` entries sharing one credential without duplicating it as a
 * literal env var per entry). Format is deliberately minimal — a flat
 * mapping of secret name to string value — matching the "BYO infra,
 * minimal moving parts" posture elsewhere in this project; no keychain
 * integration, no nesting.
 */
export async function loadSecretsFile(filePath: string): Promise<ReadonlyMap<string, string>> {
  const raw: unknown = parseYaml(await readFile(filePath, "utf8"));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ToolConfigError(filePath, undefined, "secrets file must be a flat mapping of name to string value");
  }

  const secrets = new Map<string, string>();
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      throw new ToolConfigError(filePath, undefined, `secret "${name}" must be a string value`);
    }
    secrets.set(name, value);
  }
  return secrets;
}
