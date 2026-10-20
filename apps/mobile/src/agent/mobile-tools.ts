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

  constructor(tools: readonly MobileTool[] = [deviceInfoTool, fsReadFileTool, fsListDirTool]) {
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
