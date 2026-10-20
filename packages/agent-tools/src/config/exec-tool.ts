import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";
import {
  ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
  type ToolSafetyTier,
  type ToolValidationResult,
} from "../base/tool-definition.js";
import { resolveInputRef } from "./bindings.js";
import { floorForExecEntry } from "./tier-floor.js";
import type { ExecToolEntry } from "./types.js";

const ajv = new Ajv({ allErrors: true });

/** Generated from a `kind: exec` YAML entry (design doc §2). Reuses
 * `ToolSandbox.exec()` unchanged — the only thing this adds over a
 * hand-written tool is turning validated input into argv via structured
 * `{fromInput}` binding, never a shell string (design doc §2.1). */
export class ConfigExecTool extends ToolDefinition {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly safetyTier: ToolSafetyTier;

  private readonly validator: ValidateFunction;

  constructor(
    private readonly entry: ExecToolEntry,
    private readonly projectRoot: string,
  ) {
    super();
    this.id = entry.id;
    this.description = entry.description;
    this.inputSchema = entry.inputSchema;
    this.safetyTier = entry.safetyTier ?? floorForExecEntry();
    this.validator = ajv.compile(entry.inputSchema);
  }

  validate(input: Record<string, unknown>): ToolValidationResult {
    const valid = this.validator(input);
    if (!valid) {
      return {
        valid: false,
        errors: (this.validator.errors ?? []).map((error) => `${error.instancePath} ${error.message}`.trim()),
      };
    }
    return { valid: true };
  }

  async execute(ctx: ToolExecutionContext, input: Record<string, unknown>): Promise<ToolResult> {
    let args: string[];
    try {
      args = this.entry.args.map((arg) => resolveInputRef(arg, input));
    } catch (error) {
      return {
        success: false,
        errorCode: "TOOL_VALIDATION_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }

    const result = await ctx.sandbox.exec(this.entry.command, args, {
      cwd: this.entry.cwd ?? this.projectRoot,
      ...(this.entry.envAllowlist !== undefined ? { envAllowlist: this.entry.envAllowlist } : {}),
      cancellation: ctx.cancellation,
    });

    if (result.exitCode !== 0) {
      return {
        success: false,
        errorCode: "SANDBOX_NONZERO_EXIT",
        errorMessage: result.stderr || `exited with code ${result.exitCode}`,
      };
    }
    return { success: true, output: { stdout: result.stdout, truncated: result.truncated } };
  }
}
