import { parseFrontmatter } from "./frontmatter.js";

export type SkillOrigin = "human" | "synthesized";

export interface ParsedSkill {
  readonly id: string;
  readonly triggerSummary: string;
  readonly body: string;
  readonly origin: SkillOrigin;
  readonly recommendedToolIds: readonly string[];
  readonly sourceSessionId?: string;
  readonly confidence?: number;
}

/**
 * §4.4's worked SKILL.md example has no `recommended_tool_ids` frontmatter
 * field, but `hasMatchingSkill`'s "recommendedToolIds sequence similarity"
 * check (§4.4 trigger condition #2) needs *something* on the skill side to
 * compare against — this is a minimal, optional extension to the format
 * (comma-separated tool ids) rather than literal PRD text. Absent for every
 * skill in this pass regardless, since nothing is ever written to disk yet
 * (§7.2 scope cut) — kept here for forward compatibility with the pass that
 * re-enables writing.
 */
function parseRecommendedToolIds(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.length === 0) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function parseConfidence(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Never throws — a malformed/incomplete SKILL.md is `SKILL_PARSE_ERROR`
 * territory (§12): the caller skips it and logs a warning, the catalog
 * load itself never crashes.
 */
export function parseSkillFile(raw: string): ParsedSkill | undefined {
  const { frontmatter, body } = parseFrontmatter(raw);

  const id = frontmatter["id"];
  const triggerSummary = frontmatter["trigger_summary"];
  if (id === undefined || id.length === 0 || triggerSummary === undefined || triggerSummary.length === 0) {
    return undefined;
  }

  const origin: SkillOrigin = frontmatter["origin"] === "synthesized" ? "synthesized" : "human";
  const confidence = parseConfidence(frontmatter["confidence"]);

  return {
    id,
    triggerSummary,
    body,
    origin,
    recommendedToolIds: parseRecommendedToolIds(frontmatter["recommended_tool_ids"]),
    ...(frontmatter["source_session_id"] !== undefined ? { sourceSessionId: frontmatter["source_session_id"] } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}
