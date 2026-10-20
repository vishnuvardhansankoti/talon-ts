import { isEnvRef, isInputRef, isSecretRef, type EnvRef, type SecretRef, type TemplateValue } from "./types.js";

/**
 * Resolves a literal or `{fromInput}` template value against validated
 * tool-call input. Structured binding only — never string interpolation
 * (design doc §2.1), so a value containing shell/URL metacharacters is
 * carried through as one opaque value, never spliced into a larger string.
 */
export function resolveInputRef(ref: TemplateValue, input: Record<string, unknown>): string {
  if (isInputRef(ref)) {
    const value = input[ref.fromInput];
    if (value === undefined) {
      throw new Error(`input field "${ref.fromInput}" was not provided`);
    }
    return String(value);
  }
  return String(ref);
}

/**
 * Resolves `{fromEnv}`. The YAML file never contains a secret value, only
 * the name of an env var to read at call time (design doc §4) — a missing
 * var is a hard error, not a silently empty header.
 */
export function resolveEnvRef(ref: EnvRef): string {
  const value = process.env[ref.fromEnv];
  if (value === undefined) {
    throw new Error(`environment variable "${ref.fromEnv}" is not set`);
  }
  return (ref.prefix ?? "") + value;
}

/**
 * Resolves `{fromSecret}` against the loaded secrets file (§7 follow-up).
 * Referencing a secret with no secrets file configured, or a name absent
 * from it, is a hard error — same posture as a missing env var.
 */
export function resolveSecretRef(ref: SecretRef, secrets: ReadonlyMap<string, string> | undefined): string {
  if (secrets === undefined) {
    throw new Error(`secret "${ref.fromSecret}" was referenced but no secrets file is configured`);
  }
  const value = secrets.get(ref.fromSecret);
  if (value === undefined) {
    throw new Error(`secret "${ref.fromSecret}" is not present in the configured secrets file`);
  }
  return (ref.prefix ?? "") + value;
}

export function resolveHeaderValue(
  ref: TemplateValue | EnvRef | SecretRef,
  input: Record<string, unknown>,
  secrets?: ReadonlyMap<string, string>,
): string {
  if (isEnvRef(ref)) return resolveEnvRef(ref);
  if (isSecretRef(ref)) return resolveSecretRef(ref, secrets);
  return resolveInputRef(ref, input);
}
