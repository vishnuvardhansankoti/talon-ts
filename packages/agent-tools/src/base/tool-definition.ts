import type { ToolSandbox } from "../sandbox/tool-sandbox.js";

/**
 * Type + const-object rather than a TS `enum`: a real `enum` is nominally
 * typed, so `ToolSafetyTier.SafeReadOnly` would NOT be assignable where
 * agent-core's plain string-union `ToolSafetyTierPort` is expected without
 * an unsafe cast, even though the runtime values are identical strings.
 * This pattern gives `ToolSafetyTier.SafeReadOnly`-style access while
 * staying a plain string union everywhere a port expects one.
 */
export const ToolSafetyTier = {
  SafeReadOnly: "safeReadOnly",
  HeuristicSandboxed: "heuristicSandboxed",
  DangerousConfirmRequired: "dangerousConfirmRequired",
} as const;
export type ToolSafetyTier = (typeof ToolSafetyTier)[keyof typeof ToolSafetyTier];

export interface ToolExecutionContext {
  readonly sandbox: ToolSandbox;
  readonly cancellation: AbortSignal;
  readonly sessionId: string;
}

export interface ToolValidationResult {
  readonly valid: boolean;
  readonly errors?: readonly string[];
}

export type ToolResult =
  | { readonly success: true; readonly output: unknown; readonly binaryOutput?: Uint8Array }
  | { readonly success: false; readonly errorCode: string; readonly errorMessage: string };

/** PRD §2.2. Fixed during Phase 1 implementation: resolveTier now also
 * receives the proposed input — the PRD's original ctx-only signature can't
 * actually implement shell.exec's allowlist-based tier resolution (§5.1),
 * which depends on the command being proposed, not just runtime context. */
export abstract class ToolDefinition {
  abstract readonly id: string;
  abstract readonly inputSchema: Record<string, unknown>;
  abstract readonly description: string;
  abstract readonly safetyTier: ToolSafetyTier;

  resolveTier(_ctx: ToolExecutionContext, _input: Record<string, unknown>): ToolSafetyTier {
    return this.safetyTier;
  }

  abstract validate(input: Record<string, unknown>): ToolValidationResult;
  abstract execute(ctx: ToolExecutionContext, input: Record<string, unknown>): Promise<ToolResult>;
}
