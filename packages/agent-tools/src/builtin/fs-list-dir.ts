import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  ToolDefinition,
  ToolSafetyTier,
  type ToolExecutionContext,
  type ToolResult,
  type ToolValidationResult,
} from "../base/tool-definition.js";

export class FsListDirTool extends ToolDefinition {
  readonly id = "fs.list_dir";
  readonly description = "List files in a directory within the project directory.";
  readonly safetyTier = ToolSafetyTier.SafeReadOnly;
  readonly inputSchema = {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  };

  constructor(private readonly projectRoot: string) {
    super();
  }

  validate(input: Record<string, unknown>): ToolValidationResult {
    if (typeof input["path"] !== "string") {
      return { valid: false, errors: ['"path" must be a string'] };
    }
    return { valid: true };
  }

  async execute(_ctx: ToolExecutionContext, input: Record<string, unknown>): Promise<ToolResult> {
    const requested = (input["path"] as string) || ".";
    const resolved = path.resolve(this.projectRoot, requested);
    if (!resolved.startsWith(this.projectRoot)) {
      return { success: false, errorCode: "TOOL_VALIDATION_FAILED", errorMessage: "path escapes the project root" };
    }

    try {
      const entries = await readdir(resolved, { withFileTypes: true });
      const output = entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "dir" : "file",
      }));
      return { success: true, output };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, errorCode: "TOOL_EXECUTION_FAILED", errorMessage: message };
    }
  }
}
