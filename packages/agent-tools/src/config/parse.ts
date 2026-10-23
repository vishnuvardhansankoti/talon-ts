import { ToolSafetyTier } from "../base/tool-definition.js";
import { ToolConfigError } from "./errors.js";
import { assertMeetsFloor, floorForExecEntry, floorForHttpEntry } from "./tier-floor.js";
import type {
  EnvRef,
  ExecToolEntry,
  HttpMethod,
  HttpToolEntry,
  McpToolEntry,
  SecretRef,
  TemplateValue,
  ToolConfigEntry,
} from "./types.js";
import { isEnvRef, isInputRef, isSecretRef } from "./types.js";

const ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const HTTP_METHODS: ReadonlySet<string> = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const SAFETY_TIERS: ReadonlySet<string> = new Set(Object.values(ToolSafetyTier));

function fail(filePath: string, entryIndex: number | undefined, reason: string): never {
  throw new ToolConfigError(filePath, entryIndex, reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, filePath: string, index: number): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(filePath, index, `"${field}" must be a non-empty string`);
  }
  return value as string;
}

function requireId(raw: Record<string, unknown>, filePath: string, index: number): string {
  const id = requireString(raw["id"], "id", filePath, index);
  if (!ID_PATTERN.test(id)) {
    fail(filePath, index, `"id" (${id}) must be lowercase, dot-separated segments, e.g. "weather.lookup"`);
  }
  return id;
}

function parseTemplateValue(value: unknown, field: string, filePath: string, index: number): TemplateValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (isInputRef(value)) return value;
  fail(filePath, index, `"${field}" must be a literal or { fromInput: <field> }`);
}

function parseTemplateRecord(
  value: unknown,
  field: string,
  filePath: string,
  index: number,
): Record<string, TemplateValue> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(filePath, index, `"${field}" must be an object`);
  const result: Record<string, TemplateValue> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    result[key] = parseTemplateValue(entryValue, `${field}.${key}`, filePath, index);
  }
  return result;
}

function parseHeaderValue(
  value: unknown,
  field: string,
  filePath: string,
  index: number,
): TemplateValue | EnvRef | SecretRef {
  if (isEnvRef(value)) {
    if (typeof value.fromEnv !== "string" || value.fromEnv.length === 0) {
      fail(filePath, index, `"${field}.fromEnv" must be a non-empty string`);
    }
    return value;
  }
  if (isSecretRef(value)) {
    if (typeof value.fromSecret !== "string" || value.fromSecret.length === 0) {
      fail(filePath, index, `"${field}.fromSecret" must be a non-empty string`);
    }
    return value;
  }
  return parseTemplateValue(value, field, filePath, index);
}

function parseSafetyTier(
  raw: Record<string, unknown>,
  filePath: string,
  index: number,
): ToolSafetyTier | undefined {
  const value = raw["safetyTier"];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !SAFETY_TIERS.has(value)) {
    fail(filePath, index, `"safetyTier" must be one of ${[...SAFETY_TIERS].join(", ")}`);
  }
  return value as ToolSafetyTier;
}

function parseInputSchema(raw: Record<string, unknown>, filePath: string, index: number): Record<string, unknown> {
  const schema = raw["inputSchema"];
  if (!isRecord(schema)) fail(filePath, index, '"inputSchema" must be an object');
  return schema;
}

function parseHttpEntry(raw: Record<string, unknown>, filePath: string, index: number): HttpToolEntry {
  const id = requireId(raw, filePath, index);
  const description = requireString(raw["description"], "description", filePath, index);
  const inputSchema = parseInputSchema(raw, filePath, index);

  const allowedHostsRaw = raw["allowedHosts"];
  if (!Array.isArray(allowedHostsRaw) || allowedHostsRaw.length === 0) {
    fail(filePath, index, '"allowedHosts" must be a non-empty array of hostnames');
  }
  const allowedHosts = allowedHostsRaw.map((host, i) => requireString(host, `allowedHosts[${i}]`, filePath, index));

  const methodRaw = raw["method"] ?? "GET";
  if (typeof methodRaw !== "string" || !HTTP_METHODS.has(methodRaw)) {
    fail(filePath, index, `"method" must be one of ${[...HTTP_METHODS].join(", ")}`);
  }
  const method = methodRaw as HttpMethod;

  const url = requireString(raw["url"], "url", filePath, index);
  const query = parseTemplateRecord(raw["query"], "query", filePath, index);
  const body = parseTemplateRecord(raw["body"], "body", filePath, index);

  const headersRaw = raw["headers"];
  let headers: Record<string, TemplateValue | EnvRef | SecretRef> | undefined;
  if (headersRaw !== undefined) {
    if (!isRecord(headersRaw)) fail(filePath, index, '"headers" must be an object');
    headers = {};
    for (const [key, value] of Object.entries(headersRaw)) {
      headers[key] = parseHeaderValue(value, `headers.${key}`, filePath, index);
    }
  }

  const safetyTier = parseSafetyTier(raw, filePath, index);
  const entry: HttpToolEntry = {
    kind: "http",
    id,
    description,
    inputSchema,
    allowedHosts,
    method,
    url,
    ...(query !== undefined ? { query } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(safetyTier !== undefined ? { safetyTier } : {}),
  };

  assertMeetsFloor(entry, floorForHttpEntry(method), filePath, index);
  return entry;
}

function parseExecEntry(raw: Record<string, unknown>, filePath: string, index: number): ExecToolEntry {
  const id = requireId(raw, filePath, index);
  const description = requireString(raw["description"], "description", filePath, index);
  const inputSchema = parseInputSchema(raw, filePath, index);
  const command = requireString(raw["command"], "command", filePath, index);

  const argsRaw = raw["args"] ?? [];
  if (!Array.isArray(argsRaw)) fail(filePath, index, '"args" must be an array');
  const args = argsRaw.map((arg, i) => parseTemplateValue(arg, `args[${i}]`, filePath, index));

  const cwd = raw["cwd"] !== undefined ? requireString(raw["cwd"], "cwd", filePath, index) : undefined;

  let envAllowlist: readonly string[] | undefined;
  if (raw["envAllowlist"] !== undefined) {
    const allowlistRaw = raw["envAllowlist"];
    if (!Array.isArray(allowlistRaw)) fail(filePath, index, '"envAllowlist" must be an array');
    envAllowlist = allowlistRaw.map((v, i) => requireString(v, `envAllowlist[${i}]`, filePath, index));
  }

  const safetyTier = parseSafetyTier(raw, filePath, index);
  const entry: ExecToolEntry = {
    kind: "exec",
    id,
    description,
    inputSchema,
    command,
    args,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(envAllowlist !== undefined ? { envAllowlist } : {}),
    ...(safetyTier !== undefined ? { safetyTier } : {}),
  };

  assertMeetsFloor(entry, floorForExecEntry(), filePath, index);
  return entry;
}

function parseMcpEntry(raw: Record<string, unknown>, filePath: string, index: number): McpToolEntry {
  const id = requireId(raw, filePath, index);
  const transportRaw = raw["transport"];
  if (transportRaw !== "stdio" && transportRaw !== "http") {
    fail(filePath, index, '"transport" must be "stdio" or "http"');
  }

  if (transportRaw === "stdio") {
    const commandRaw = raw["command"];
    if (!Array.isArray(commandRaw) || commandRaw.length === 0) {
      fail(filePath, index, '"command" must be a non-empty array of strings for transport "stdio"');
    }
    const command = commandRaw.map((v, i) => requireString(v, `command[${i}]`, filePath, index));

    const envRaw = raw["env"];
    let env: Record<string, TemplateValue | EnvRef | SecretRef> | undefined;
    if (envRaw !== undefined) {
      if (!isRecord(envRaw)) fail(filePath, index, '"env" must be an object');
      env = {};
      for (const [key, value] of Object.entries(envRaw)) {
        env[key] = parseHeaderValue(value, `env.${key}`, filePath, index);
      }
    }

    return { kind: "mcp", id, transport: "stdio", command, ...(env !== undefined ? { env } : {}) };
  }

  if (raw["env"] !== undefined) {
    fail(filePath, index, '"env" is only valid for transport "stdio"');
  }
  const url = requireString(raw["url"], "url", filePath, index);
  return { kind: "mcp", id, transport: "http", url };
}

/** Design doc §6: any invalid entry fails the whole file, naming the entry. */
export function parseToolConfigFile(raw: unknown, filePath: string): ToolConfigEntry[] {
  if (!isRecord(raw) || !Array.isArray(raw["tools"])) {
    fail(filePath, undefined, 'root document must be an object with a "tools" array');
  }

  const entries: ToolConfigEntry[] = [];
  const seenIds = new Set<string>();

  (raw["tools"] as unknown[]).forEach((rawEntry, index) => {
    if (!isRecord(rawEntry)) fail(filePath, index, "entry must be an object");

    const kind = rawEntry["kind"];
    let entry: ToolConfigEntry;
    switch (kind) {
      case "http":
        entry = parseHttpEntry(rawEntry, filePath, index);
        break;
      case "exec":
        entry = parseExecEntry(rawEntry, filePath, index);
        break;
      case "mcp":
        entry = parseMcpEntry(rawEntry, filePath, index);
        break;
      default:
        fail(filePath, index, `unknown "kind" (${String(kind)}) — must be "http", "exec", or "mcp"`);
    }

    if (seenIds.has(entry.id)) {
      fail(filePath, index, `duplicate tool id "${entry.id}" within this file`);
    }
    seenIds.add(entry.id);
    entries.push(entry);
  });

  return entries;
}
