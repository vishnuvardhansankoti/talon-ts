import type { ValidateFunction } from "ajv";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
  type ToolSafetyTier,
  type ToolValidationResult,
} from "../base/tool-definition.js";
import { MCP_TOOL_TIER } from "./tier-floor.js";

/**
 * Wraps one tool discovered from a connected MCP server's `tools/list`
 * (design doc §2/§5). `safetyTier` is unconditionally the top tier — an
 * MCP entry's YAML has no `safetyTier` field to parse in the first place,
 * because the person editing the config isn't the one who wrote this
 * tool's behavior; the connected server is, and it can change what a tool
 * does between runs without the local config changing at all.
 */
export class ConfigMcpTool extends ToolDefinition {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly safetyTier: ToolSafetyTier = MCP_TOOL_TIER;

  constructor(
    id: string,
    description: string,
    inputSchema: Record<string, unknown>,
    private readonly validator: ValidateFunction,
    private readonly client: Client,
    private readonly serverToolName: string,
  ) {
    super();
    this.id = id;
    this.description = description;
    this.inputSchema = inputSchema;
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

  async execute(_ctx: ToolExecutionContext, input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await this.client.callTool({ name: this.serverToolName, arguments: input });
      return { success: true, output: result };
    } catch (error) {
      return {
        success: false,
        errorCode: "MCP_CALL_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
