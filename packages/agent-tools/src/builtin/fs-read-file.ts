import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ToolDefinition,
  ToolSafetyTier,
  type ToolExecutionContext,
  type ToolResult,
  type ToolValidationResult,
} from "../base/tool-definition.js";

const MAX_READ_CHARS = 256 * 1024;

export class FsReadFileTool extends ToolDefinition {
  readonly id = "fs.read_file";
  readonly description = "Read a UTF-8 text file within the project directory.";
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
    if (typeof input["path"] !== "string" || input["path"].length === 0) {
      return { valid: false, errors: ['"path" must be a non-empty string'] };
    }
    return { valid: true };
  }

  async execute(_ctx: ToolExecutionContext, input: Record<string, unknown>): Promise<ToolResult> {
    const requested = input["path"] as string;
    const resolved = path.resolve(this.projectRoot, requested);
    if (!resolved.startsWith(this.projectRoot)) {
      return { success: false, errorCode: "TOOL_VALIDATION_FAILED", errorMessage: "path escapes the project root" };
    }

    try {
      const content = await readFile(resolved, "utf8");
      return { success: true, output: content.slice(0, MAX_READ_CHARS) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, errorCode: "TOOL_EXECUTION_FAILED", errorMessage: message };
    }
  }
}
