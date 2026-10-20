import { ToolSafetyTier } from "../base/tool-definition.js";
import { ToolConfigError } from "./errors.js";
import type { ExecToolEntry, HttpToolEntry } from "./types.js";

const TIER_RANK: Record<ToolSafetyTier, number> = {
  [ToolSafetyTier.SafeReadOnly]: 0,
  [ToolSafetyTier.HeuristicSandboxed]: 1,
  [ToolSafetyTier.DangerousConfirmRequired]: 2,
};

const MUTATING_HTTP_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Design doc §3: a YAML entry is data, not reviewed code, so it is never
 * trusted to self-assign an arbitrarily permissive tier. Each `kind` (and,
 * for `http`, each method) has a floor; a declared `safetyTier` may raise
 * above it — same "raise, never lower" rule `ToolDefinition.resolveTier`
 * already follows — but never below.
 */
export function floorForHttpEntry(method: string): ToolSafetyTier {
  return MUTATING_HTTP_METHODS.has(method) ? ToolSafetyTier.DangerousConfirmRequired : ToolSafetyTier.HeuristicSandboxed;
}

export function floorForExecEntry(): ToolSafetyTier {
  return ToolSafetyTier.HeuristicSandboxed;
}

/** `mcp` entries have no declarable tier at all — every discovered tool is
 * unconditionally floored at the top tier (design doc §3). */
export const MCP_TOOL_TIER: ToolSafetyTier = ToolSafetyTier.DangerousConfirmRequired;

export function assertMeetsFloor(
  entry: HttpToolEntry | ExecToolEntry,
  floor: ToolSafetyTier,
  filePath: string,
  entryIndex: number,
): void {
  if (entry.safetyTier === undefined) return;
  if (TIER_RANK[entry.safetyTier] < TIER_RANK[floor]) {
    throw new ToolConfigError(
      filePath,
      entryIndex,
      `safetyTier "${entry.safetyTier}" is below floor "${floor}" for kind "${entry.kind}"` +
        (entry.kind === "http" ? ` (method ${entry.method})` : ""),
    );
  }
}
