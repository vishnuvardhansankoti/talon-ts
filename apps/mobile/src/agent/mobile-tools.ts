import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import type {
  ToolExecutionPortContext,
  ToolExecutionResultPort,
  ToolRegistryPort,
  ToolSafetyTierPort,
} from "@talon/agent-core";

interface MobileTool {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly safetyTier: ToolSafetyTierPort;
  execute(input: Record<string, unknown>): Promise<ToolExecutionResultPort>;
}

/**
 * Every mobile tool is confined to the app's own sandboxed document
 * directory — PRD §5.1's mobile row: "no raw shell access... limited to
 * in-process, OS-mediated operations (app sandbox file I/O)." `node:path`
 * isn't available under Hermes, so containment here is a plain string
 * check on the *requested* segment, before it ever reaches `File`/
 * `Directory` (expo-file-system's current, non-legacy API — the older
 * `documentDirectory` constant + `readAsStringAsync`/`readDirectoryAsync`
 * free functions this was first written against don't exist in
 * expo-file-system 58). Rejecting any ".." anywhere is stricter than full
 * path normalization (packages/agent-tools/src/builtin/fs-read-file.ts's
 * `path.resolve` + prefix-check approach), which is fine here since
 * there's no legitimate reason a request would need one.
 */
function isPathSafe(requested: string): boolean {
  return !requested.startsWith("/") && !requested.includes("..");
}

const deviceInfoTool: MobileTool = {
  id: "device.info",
  description: "Return basic platform info about the device this app is running on.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  safetyTier: "safeReadOnly",
  async execute() {
    return { success: true, output: { platform: Platform.OS, osVersion: Platform.Version } };
  },
};

const fsReadFileTool: MobileTool = {
  id: "fs.read_file",
  description: "Read a UTF-8 text file within the app's sandboxed document directory.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  // Matches PRD §5.1's own matrix row for fs.read_file — same tier as the
  // desktop/talond builtin (packages/agent-tools/src/builtin/fs-read-file.ts).
  safetyTier: "safeReadOnly",
  async execute(input) {
    const requested = input["path"];
    if (typeof requested !== "string" || requested.length === 0) {
      return { success: false, errorCode: "TOOL_VALIDATION_FAILED", errorMessage: '"path" must be a non-empty string' };
    }
    if (!isPathSafe(requested)) {
      return { success: false, errorCode: "TOOL_VALIDATION_FAILED", errorMessage: "path escapes the sandboxed document directory" };
    }
    const file = new File(Paths.document, requested);
    try {
      if (!file.exists) {
        return { success: false, errorCode: "TOOL_EXECUTION_FAILED", errorMessage: "file does not exist" };
      }
      const content = await file.text();
      return { success: true, output: content };
    } catch (error) {
      return { success: false, errorCode: "TOOL_EXECUTION_FAILED", errorMessage: error instanceof Error ? error.message : String(error) };
    }
  },
};

const fsListDirTool: MobileTool = {
  id: "fs.list_dir",
  description: "List entries within the app's sandboxed document directory.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  safetyTier: "safeReadOnly",
  async execute(input) {
    const requested = input["path"];
    if (typeof requested !== "string") {
      return { success: false, errorCode: "TOOL_VALIDATION_FAILED", errorMessage: '"path" must be a string' };
    }
    if (!isPathSafe(requested)) {
      return { success: false, errorCode: "TOOL_VALIDATION_FAILED", errorMessage: "path escapes the sandboxed document directory" };
    }
    const dir = requested === "" || requested === "." ? Paths.document : new Directory(Paths.document, requested);
    try {
      if (!dir.exists) {
        return { success: false, errorCode: "TOOL_EXECUTION_FAILED", errorMessage: "directory does not exist" };
      }
      const entries = dir.list().map((entry) => entry.name);
      return { success: true, output: entries };
    } catch (error) {
      return { success: false, errorCode: "TOOL_EXECUTION_FAILED", errorMessage: error instanceof Error ? error.message : String(error) };
    }
  },
};

interface TavilySearchResult {
  readonly title: string;
  readonly url: string;
  readonly content: string;
}

interface TavilySearchResponse {
  readonly results?: readonly TavilySearchResult[];
  readonly answer?: string;
}

/**
 * The desktop/talond equivalent (docs/architecture/yaml-tool-config.md,
 * packages/agent-tools/examples/tools.example.yaml's "websearch" entry)
 * spawns Tavily's official MCP server as a local stdio process. That's not
 * an option here — Hermes has no `node:child_process`, so there's nothing
 * to spawn — and pulling in `@modelcontextprotocol/sdk`'s full client just
 * to drive Tavily's *hosted* HTTP MCP endpoint would be a lot of protocol
 * machinery for one tool. Tavily's plain REST `/search` endpoint
 * (https://docs.tavily.com/documentation/api-reference/endpoint/search)
 * does the same job as a single `fetch()` call, matching every other
 * mobile-only tool/provider in this app (no Node dependency, ever).
 *
 * A factory (not a static const like the three tools above) because it
 * needs a per-session API key — see this file's only caller,
 * agent-session.ts, which only includes it in the registry at all when a
 * key is actually configured (src/settings/tavily-settings.ts).
 */
export function createWebSearchTool(apiKey: string): MobileTool {
  return {
    id: "web.search",
    description: "Search the web for current information and return the top matching results.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    // Read-only from the user's perspective (no state mutation, nothing
    // destructive) but sends the query text to a third-party service —
    // unlike device.info/fs.*, which never leave the sandbox. Floored one
    // tier above those, matching how a config-declared `http` GET entry
    // floors at heuristicSandboxed rather than safeReadOnly (design doc
    // §3) for the same reason: it's a network call, not a local read.
    safetyTier: "heuristicSandboxed",
    async execute(input) {
      const query = input["query"];
      if (typeof query !== "string" || query.trim().length === 0) {
        return { success: false, errorCode: "TOOL_VALIDATION_FAILED", errorMessage: '"query" must be a non-empty string' };
      }

      let res: Response;
      try {
        res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ query }),
        });
      } catch (error) {
        return { success: false, errorCode: "TOOL_EXECUTION_FAILED", errorMessage: error instanceof Error ? error.message : String(error) };
      }

      if (!res.ok) {
        return { success: false, errorCode: "TOOL_EXECUTION_FAILED", errorMessage: `tavily search failed: ${res.status} ${res.statusText}` };
      }

      const body = (await res.json()) as TavilySearchResponse;
      const results = (body.results ?? []).map(({ title, url, content }) => ({ title, url, content }));
      return { success: true, output: { ...(body.answer !== undefined ? { answer: body.answer } : {}), results } };
    },
  };
}

/** The tools registered regardless of settings — agent-session.ts appends
 * `createWebSearchTool(apiKey)` to this list itself, only when a Tavily
 * key is actually configured, rather than this file reaching into
 * settings storage to decide that on its own. */
export const DEFAULT_MOBILE_TOOLS: readonly MobileTool[] = [deviceInfoTool, fsReadFileTool, fsListDirTool];

/**
 * Structurally satisfies agent-core's ToolRegistryPort, same as
 * @talon/agent-tools's own ToolRegistry does for desktop/talond — written
 * fresh rather than imported, since `agent-tools`' barrel unconditionally
 * constructs a `ToolSandbox` (node:net + execa) in its own ToolRegistry
 * constructor; importing anything from that package at all would pull a
 * Node-process-spawning dependency into the Metro bundle.
 */
export class MobileToolRegistry implements ToolRegistryPort {
  private readonly tools: ReadonlyMap<string, MobileTool>;

  constructor(tools: readonly MobileTool[] = DEFAULT_MOBILE_TOOLS) {
    this.tools = new Map(tools.map((tool) => [tool.id, tool]));
  }

  listSchemas() {
    return [...this.tools.values()].map((tool) => ({
      id: tool.id,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  resolveTier(toolId: string, _input: Record<string, unknown>): ToolSafetyTierPort {
    return this.tools.get(toolId)?.safetyTier ?? "dangerousConfirmRequired";
  }

  async execute(
    toolId: string,
    input: Record<string, unknown>,
    _ctx: ToolExecutionPortContext,
  ): Promise<ToolExecutionResultPort> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return { success: false, errorCode: "TOOL_NOT_FOUND", errorMessage: `no tool registered with id "${toolId}"` };
    }
    return tool.execute(input);
  }
}
