import { Ajv } from "ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ToolDefinition } from "../base/tool-definition.js";
import { resolveHeaderValue } from "./bindings.js";
import { ConfigMcpTool } from "./mcp-tool.js";
import type { McpToolEntry } from "./types.js";

export interface McpConnectionHandle {
  readonly tools: readonly ToolDefinition[];
  close(): Promise<void>;
}

function buildTransport(
  entry: McpToolEntry,
  secrets: ReadonlyMap<string, string> | undefined,
): StdioClientTransport | StreamableHTTPClientTransport {
  if (entry.transport === "stdio") {
    const [executable, ...args] = entry.command ?? [];
    if (executable === undefined) {
      throw new Error(`mcp entry "${entry.id}": command is required for transport "stdio"`);
    }
    // Resolved at connect time, once per live connection — not per tool
    // call, since the stdio child process is spawned once and stays alive
    // for the connection's lifetime (design doc §5). {fromInput} has no
    // meaning here (there's no tool-call input yet), so it's resolved
    // against an empty object and will fail loudly if ever referenced.
    const env =
      entry.env !== undefined
        ? Object.fromEntries(
            Object.entries(entry.env).map(([key, value]) => [key, resolveHeaderValue(value, {}, secrets)]),
          )
        : undefined;
    return new StdioClientTransport({ command: executable, args, ...(env !== undefined ? { env } : {}) });
  }

  if (entry.url === undefined) {
    throw new Error(`mcp entry "${entry.id}": url is required for transport "http"`);
  }
  return new StreamableHTTPClientTransport(new URL(entry.url));
}

/**
 * Connects to one `kind: mcp` entry's server, discovers its tools via
 * `tools/list`, and wraps each as a `ConfigMcpTool` namespaced
 * `<entryId>.<serverToolName>` (design doc §5) — e.g. entry id "figma" +
 * server tool "get_file" registers as "figma.get_file".
 */
export async function connectMcpEntry(
  entry: McpToolEntry,
  secrets?: ReadonlyMap<string, string>,
): Promise<McpConnectionHandle> {
  const client = new Client({ name: "talon-agent-tools", version: "0.1.0" });
  const transport = buildTransport(entry, secrets);
  // StreamableHTTPClientTransport's `sessionId` getter is typed
  // `string | undefined` against Transport's `sessionId?: string` —
  // a pre-existing mismatch in the SDK's own types under this repo's
  // `exactOptionalPropertyTypes`, not a real incompatibility.
  await client.connect(transport as Transport);

  const ajv = new Ajv({ allErrors: true });
  const { tools: discovered } = await client.listTools();
  const tools = discovered.map((tool) => {
    const inputSchema = tool.inputSchema as Record<string, unknown>;
    return new ConfigMcpTool(
      `${entry.id}.${tool.name}`,
      tool.description ?? tool.name,
      inputSchema,
      ajv.compile(inputSchema),
      client,
      tool.name,
    );
  });

  return { tools, close: () => client.close() };
}
