import { ToolSafetyTier, type ToolDefinition, type ToolExecutionContext } from "../base/tool-definition.js";
import { ToolSandbox } from "../sandbox/tool-sandbox.js";

export interface ToolRegistrySchema {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ToolRegistryExecutionContext {
  readonly sessionId: string;
  readonly cancellation: AbortSignal;
}

export type ToolRegistryResult =
  | { readonly success: true; readonly output: unknown }
  | { readonly success: false; readonly errorCode: string; readonly errorMessage: string };

/**
 * Structurally satisfies agent-core's ToolRegistryPort (listSchemas /
 * resolveTier / execute, matching field names and shapes) without agent-core
 * ever importing this package — see packages/agent-core/src/shared/ports.ts.
 */
export class ToolRegistry {
  private readonly byId = new Map<string, ToolDefinition>();
  private readonly sandbox = new ToolSandbox();

  constructor(tools: readonly ToolDefinition[]) {
    for (const tool of tools) {
      this.byId.set(tool.id, tool);
    }
  }

  listSchemas(): ToolRegistrySchema[] {
    return [...this.byId.values()].map((tool) => ({
      id: tool.id,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  resolveTier(toolId: string, input: Record<string, unknown>): ToolSafetyTier {
    const tool = this.byId.get(toolId);
    if (!tool) {
      // An unrecognized tool id is never treated as permissive.
      return ToolSafetyTier.DangerousConfirmRequired;
    }
    const ctx: ToolExecutionContext = {
      sandbox: this.sandbox,
      cancellation: new AbortController().signal,
      sessionId: "tier-resolution",
    };
    return tool.resolveTier(ctx, input);
  }

  async execute(
    toolId: string,
    input: Record<string, unknown>,
    ctx: ToolRegistryExecutionContext,
  ): Promise<ToolRegistryResult> {
    const tool = this.byId.get(toolId);
    if (!tool) {
      return { success: false, errorCode: "TOOL_NOT_FOUND", errorMessage: `no tool registered with id "${toolId}"` };
    }

    const validation = tool.validate(input);
    if (!validation.valid) {
      return {
        success: false,
        errorCode: "TOOL_VALIDATION_FAILED",
        errorMessage: (validation.errors ?? ["invalid input"]).join("; "),
      };
    }

    const fullCtx: ToolExecutionContext = {
      sandbox: this.sandbox,
      cancellation: ctx.cancellation,
      sessionId: ctx.sessionId,
    };

    const result = await tool.execute(fullCtx, input);
    return result.success
      ? { success: true, output: result.output }
      : { success: false, errorCode: result.errorCode, errorMessage: result.errorMessage };
  }
}
