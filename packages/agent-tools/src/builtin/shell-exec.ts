import {
  ToolDefinition,
  ToolSafetyTier,
  type ToolExecutionContext,
  type ToolResult,
  type ToolValidationResult,
} from "../base/tool-definition.js";

const ALLOWLISTED_COMMANDS: readonly string[] = ["git status", "npm test", "ls", "pwd"];

function isAllowlisted(command: string): boolean {
  return ALLOWLISTED_COMMANDS.some((allowed) => command === allowed || command.startsWith(`${allowed} `));
}

/** PRD §5.1. Floor is heuristicSandboxed (allowlisted commands); resolveTier
 * raises to dangerousConfirmRequired for anything not on the allowlist —
 * raising the floor, never lowering it, per the ToolDefinition contract. */
export class ShellExecTool extends ToolDefinition {
  readonly id = "shell.exec";
  readonly description = "Run a shell command in the project directory.";
  readonly safetyTier = ToolSafetyTier.HeuristicSandboxed;
  readonly inputSchema = {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  };

  constructor(private readonly projectRoot: string) {
    super();
  }

  validate(input: Record<string, unknown>): ToolValidationResult {
    if (typeof input["command"] !== "string" || input["command"].trim().length === 0) {
      return { valid: false, errors: ['"command" must be a non-empty string'] };
    }
    return { valid: true };
  }

  override resolveTier(_ctx: ToolExecutionContext, input: Record<string, unknown>): ToolSafetyTier {
    const command = typeof input["command"] === "string" ? input["command"].trim() : "";
    return isAllowlisted(command) ? ToolSafetyTier.HeuristicSandboxed : ToolSafetyTier.DangerousConfirmRequired;
  }

  async execute(ctx: ToolExecutionContext, input: Record<string, unknown>): Promise<ToolResult> {
    const command = (input["command"] as string).trim();
    // Naive whitespace split — fine for the allowlisted commands this tool
    // targets in Phase 1; a real shell-quoting parser is out of scope here.
    const [program, ...args] = command.split(/\s+/);
    if (!program) {
      return { success: false, errorCode: "TOOL_VALIDATION_FAILED", errorMessage: "empty command" };
    }

    const result = await ctx.sandbox.exec(program, args, {
      cwd: this.projectRoot,
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
