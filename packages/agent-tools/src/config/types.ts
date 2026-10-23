import type { ToolSafetyTier } from "../base/tool-definition.js";

/** A value an `http`/`exec` entry binds from the model's validated tool-call input. */
export type InputRef = { readonly fromInput: string };

/** A value an `http`/`mcp` entry binds from an environment variable, never a literal secret. */
export interface EnvRef {
  readonly fromEnv: string;
  readonly prefix?: string;
}

/** A value an `http`/`mcp` entry binds from the configured secrets file (§7
 * follow-up: a dedicated store for cases where env vars are awkward,
 * e.g. many entries sharing one credential). Never a literal secret. */
export interface SecretRef {
  readonly fromSecret: string;
  readonly prefix?: string;
}

export type TemplateValue = string | number | boolean | InputRef;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpToolEntry {
  readonly kind: "http";
  readonly id: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly allowedHosts: readonly string[];
  readonly method: HttpMethod;
  readonly url: string;
  readonly query?: Readonly<Record<string, TemplateValue>>;
  readonly headers?: Readonly<Record<string, TemplateValue | EnvRef | SecretRef>>;
  readonly body?: Readonly<Record<string, TemplateValue>>;
  readonly safetyTier?: ToolSafetyTier;
}

export interface ExecToolEntry {
  readonly kind: "exec";
  readonly id: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly command: string;
  readonly args: readonly TemplateValue[];
  readonly cwd?: string;
  readonly envAllowlist?: readonly string[];
  readonly safetyTier?: ToolSafetyTier;
}

export type McpTransport = "stdio" | "http";

export interface McpToolEntry {
  readonly kind: "mcp";
  readonly id: string;
  readonly transport: McpTransport;
  /** Required for `transport: "stdio"`. */
  readonly command?: readonly string[];
  /** Required for `transport: "http"`. */
  readonly url?: string;
  /** Env vars to set on the spawned stdio process (e.g. an API key the
   * server itself reads from its environment, like `TAVILY_API_KEY`) —
   * only meaningful for `transport: "stdio"`. */
  readonly env?: Readonly<Record<string, TemplateValue | EnvRef | SecretRef>>;
}

export type ToolConfigEntry = HttpToolEntry | ExecToolEntry | McpToolEntry;

export interface ToolConfigFile {
  readonly tools: readonly ToolConfigEntry[];
}

export function isInputRef(value: unknown): value is InputRef {
  return typeof value === "object" && value !== null && typeof (value as InputRef).fromInput === "string";
}

export function isEnvRef(value: unknown): value is EnvRef {
  return typeof value === "object" && value !== null && typeof (value as EnvRef).fromEnv === "string";
}

export function isSecretRef(value: unknown): value is SecretRef {
  return typeof value === "object" && value !== null && typeof (value as SecretRef).fromSecret === "string";
}
