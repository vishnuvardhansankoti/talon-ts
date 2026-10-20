import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ToolDefinition } from "../base/tool-definition.js";
import { ToolConfigError } from "./errors.js";
import { ConfigExecTool } from "./exec-tool.js";
import { ConfigHttpTool } from "./http-tool.js";
import { connectMcpEntry } from "./mcp-client.js";
import { parseToolConfigFile } from "./parse.js";
import { loadSecretsFile } from "./secrets.js";

export interface ToolConfigHandle {
  readonly tools: readonly ToolDefinition[];
  close(): Promise<void>;
}

const YAML_EXTENSIONS: ReadonlySet<string> = new Set([".yaml", ".yml"]);

/**
 * `configPath` may be a single file, or a directory of flat (non-recursive)
 * `*.yaml`/`*.yml` fragments — the §7 follow-up for managing many tool
 * definitions across files. Sorted for deterministic, reproducible
 * cross-file duplicate-id error messages (§ below).
 */
export async function resolveConfigFiles(configPath: string): Promise<string[]> {
  const stats = await stat(configPath);
  if (stats.isFile()) return [configPath];
  if (!stats.isDirectory()) {
    throw new Error(`tools config path "${configPath}" is neither a file nor a directory`);
  }

  const names = await readdir(configPath);
  return names
    .filter((name) => YAML_EXTENSIONS.has(path.extname(name)))
    .sort()
    .map((name) => path.join(configPath, name));
}

/**
 * Design doc §5: `http`/`exec` entries are pure data and resolve inside
 * this call with no I/O; `mcp` entries actually connect (spawn a stdio
 * child process, or open an HTTP connection) during this call, and their
 * discovered tools proxy calls back over that now-live connection. The
 * returned handle's `close()` tears down every such connection — the app
 * layer calls it once, on shutdown.
 *
 * `secretsPath`, if given, is loaded once and threaded into every `http`
 * entry's `{fromSecret}` resolution for this load (§7 follow-up).
 */
export async function loadToolsFromYaml(
  configPath: string,
  projectRoot: string,
  secretsPath?: string,
): Promise<ToolConfigHandle> {
  const filePaths = await resolveConfigFiles(configPath);
  const secrets = secretsPath !== undefined ? await loadSecretsFile(secretsPath) : undefined;

  const tools: ToolDefinition[] = [];
  const closers: Array<() => Promise<void>> = [];
  // Within-file duplicate ids are already rejected by parseToolConfigFile;
  // this tracks ids *across* files in a directory load, naming both files
  // in the error — parseToolConfigFile has no visibility into other files.
  const declaredIn = new Map<string, string>();

  for (const filePath of filePaths) {
    const raw: unknown = parseYaml(await readFile(filePath, "utf8"));
    const entries = parseToolConfigFile(raw, filePath);

    for (const entry of entries) {
      const firstDeclaredIn = declaredIn.get(entry.id);
      if (firstDeclaredIn !== undefined) {
        throw new ToolConfigError(filePath, undefined, `duplicate tool id "${entry.id}" (already declared in ${firstDeclaredIn})`);
      }
      declaredIn.set(entry.id, filePath);

      switch (entry.kind) {
        case "http":
          tools.push(new ConfigHttpTool(entry, secrets));
          break;
        case "exec":
          tools.push(new ConfigExecTool(entry, projectRoot));
          break;
        case "mcp": {
          const connection = await connectMcpEntry(entry);
          tools.push(...connection.tools);
          closers.push(connection.close);
          break;
        }
      }
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.all(closers.map((close) => close()));
    },
  };
}
