import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";
import {
  ToolDefinition,
  type ToolExecutionContext,
  type ToolResult,
  type ToolSafetyTier,
  type ToolValidationResult,
} from "../base/tool-definition.js";
import { resolveHeaderValue, resolveInputRef } from "./bindings.js";
import { floorForHttpEntry } from "./tier-floor.js";
import type { HttpToolEntry } from "./types.js";

const ajv = new Ajv({ allErrors: true });

/** Generated from a `kind: http` YAML entry (design doc §2). Builds the
 * request from structured `{fromInput}`/`{fromEnv}` templates (never string
 * interpolation) and executes it through `ToolSandbox.fetch()`, which owns
 * the allowedHosts/SSRF enforcement (design doc §4) — this class only
 * assembles the request, it never calls the global `fetch` directly. */
export class ConfigHttpTool extends ToolDefinition {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly safetyTier: ToolSafetyTier;

  private readonly validator: ValidateFunction;

  constructor(
    private readonly entry: HttpToolEntry,
    private readonly secrets?: ReadonlyMap<string, string>,
  ) {
    super();
    this.id = entry.id;
    this.description = entry.description;
    this.inputSchema = entry.inputSchema;
    this.safetyTier = entry.safetyTier ?? floorForHttpEntry(entry.method);
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
    let url: URL;
    let headers: Record<string, string>;
    let body: string | undefined;
    try {
      url = new URL(this.entry.url);
      for (const [key, value] of Object.entries(this.entry.query ?? {})) {
        url.searchParams.set(key, resolveInputRef(value, input));
      }

      headers = {};
      for (const [key, value] of Object.entries(this.entry.headers ?? {})) {
        headers[key] = resolveHeaderValue(value, input, this.secrets);
      }

      if (this.entry.body !== undefined) {
        const resolvedBody: Record<string, string> = {};
        for (const [key, value] of Object.entries(this.entry.body)) {
          resolvedBody[key] = resolveInputRef(value, input);
        }
        body = JSON.stringify(resolvedBody);
        headers["Content-Type"] ??= "application/json";
      }
    } catch (error) {
      return {
        success: false,
        errorCode: "TOOL_VALIDATION_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const result = await ctx.sandbox.fetch(
        { method: this.entry.method, url: url.toString(), headers, ...(body !== undefined ? { body } : {}) },
        { allowedHosts: this.entry.allowedHosts, cancellation: ctx.cancellation },
      );

      if (result.status < 200 || result.status >= 300) {
        return {
          success: false,
          errorCode: "CONFIG_HTTP_NON_2XX",
          errorMessage: `request to ${this.entry.url} returned status ${result.status}: ${result.body}`,
        };
      }
      return { success: true, output: { status: result.status, body: result.body, truncated: result.truncated } };
    } catch (error) {
      return {
        success: false,
        errorCode: "CONFIG_HTTP_REQUEST_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
