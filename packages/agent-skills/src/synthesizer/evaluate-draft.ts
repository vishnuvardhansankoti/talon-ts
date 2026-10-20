import { parseSkillFile } from "../parser/skill-parser.js";

export interface SkillDraftEvaluation {
  readonly accepted: boolean;
  readonly skillId?: string;
  readonly reason: string;
}

const CONFIDENCE_THRESHOLD = 0.6;

/**
 * §4.4's Draft → Evaluate pipeline, "Evaluate" half. The tier-preservation
 * gate from the PRD text doesn't appear here — design doc filled gap #3
 * turns it into a trigger-condition exclusion the caller (`AgentLoop`)
 * applies *before* ever requesting a draft, since the draft format has no
 * field capable of making or violating a tier claim in the first place.
 * Never writes anything to disk or SQLite regardless of outcome — §7.2's
 * Phase 2 scope cut ("no auto-write yet — logged only").
 */
export function evaluateDraft(rawDraftText: string): SkillDraftEvaluation {
  const parsed = parseSkillFile(rawDraftText);
  if (parsed === undefined) {
    return { accepted: false, reason: "draft could not be parsed (missing id/trigger_summary)" };
  }

  if (parsed.confidence === undefined) {
    return { accepted: false, skillId: parsed.id, reason: "draft has no confidence field" };
  }
  if (parsed.confidence < CONFIDENCE_THRESHOLD) {
    return {
      accepted: false,
      skillId: parsed.id,
      reason: `confidence ${parsed.confidence} is below the ${CONFIDENCE_THRESHOLD} threshold`,
    };
  }

  return { accepted: true, skillId: parsed.id, reason: `confidence ${parsed.confidence} meets the ${CONFIDENCE_THRESHOLD} threshold` };
}
