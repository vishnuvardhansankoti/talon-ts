import type {
  SkillActivationContextPort,
  SkillActivationPort,
  SkillCatalogEntryPort,
  SkillDraftEvaluationPort,
  SkillsPort,
} from "@talon/agent-core";

/**
 * Phase 3 (mobile) scope cut, same reasoning as mobile-memory.ts:
 * `@talon/agent-skills` reads from the filesystem via `node:fs` to load
 * bundled/project skills — not available under Hermes. An empty catalog
 * means the loop's progressive-disclosure system prompt injection and
 * per-turn `activate()` call are both genuinely exercised (the wiring is
 * real), they just always see zero skills on mobile today.
 */
export class NoopMobileSkills implements SkillsPort {
  async listCatalog(): Promise<readonly SkillCatalogEntryPort[]> {
    return [];
  }

  async activate(_ctx: SkillActivationContextPort): Promise<readonly SkillActivationPort[]> {
    return [];
  }

  async hasMatchingSkill(_toolIds: readonly string[]): Promise<boolean> {
    return false;
  }

  async evaluateDraft(_rawDraftText: string): Promise<SkillDraftEvaluationPort> {
    return { accepted: false, reason: "skill synthesis is not implemented on mobile (Phase 3 scope)" };
  }
}
