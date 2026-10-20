import path from "node:path";
import { listSkillFiles, readSkillFile, resolveBundledSkillsDir } from "../loader/skill-files.js";
import { parseSkillFile } from "../parser/skill-parser.js";
import { MarkdownSkill, type SkillActivationContext } from "../skill.js";
import { evaluateDraft, type SkillDraftEvaluation } from "../synthesizer/evaluate-draft.js";

export interface SkillCatalogEntry {
  readonly id: string;
  readonly triggerSummary: string;
}

export interface SkillActivation {
  readonly id: string;
  readonly body: string;
}

function recommendedToolIdsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Scans both skill roots once at construction — bundled
 * (`packages/agent-skills/skills/*.md`, human-authored) and project
 * (`<projectRoot>/.talon/skills/*.md`, per-project per design doc decision
 * #1's precedent from Pass 1 — absent until anything is ever written
 * there, which nothing does yet in this pass). Stateless and shared-safe
 * across concurrent `AgentLoop`s: which skills have already activated
 * *this session* is tracked by the caller (`AgentLoop`), passed in via
 * `ctx.activeSkillIds` on every `activate()` call, not held here.
 *
 * Every public method is `async` even though the underlying work is
 * synchronous — matching `MemoryPort`'s convention exactly (see design
 * doc) so this class satisfies `agent-core`'s `SkillsPort` directly, the
 * same way `MemoryStore` satisfies `MemoryPort`, with zero adapter needed
 * at the app layer.
 */
export class SkillCatalog {
  private constructor(private readonly skills: readonly MarkdownSkill[]) {}

  static async open(projectRoot: string): Promise<SkillCatalog> {
    const bundledDir = resolveBundledSkillsDir();
    const projectDir = path.join(projectRoot, ".talon", "skills");
    const [bundledFiles, projectFiles] = await Promise.all([listSkillFiles(bundledDir), listSkillFiles(projectDir)]);

    const skills: MarkdownSkill[] = [];
    const seenIds = new Set<string>();

    for (const filePath of [...bundledFiles, ...projectFiles]) {
      const raw = await readSkillFile(filePath);
      const parsed = parseSkillFile(raw);
      if (parsed === undefined) {
        // SKILL_PARSE_ERROR (§12): skip, warn, never crash the catalog load.
        console.warn(`agent-skills: skipping malformed skill file (missing id/trigger_summary): ${filePath}`);
        continue;
      }
      if (seenIds.has(parsed.id)) {
        console.warn(`agent-skills: duplicate skill id "${parsed.id}" in ${filePath} — skipping`);
        continue;
      }
      seenIds.add(parsed.id);
      skills.push(new MarkdownSkill(parsed));
    }

    return new SkillCatalog(skills);
  }

  /** The "unexpanded catalog index" (§2.2) — id + triggerSummary only,
   * always in context regardless of activation. */
  async listCatalog(): Promise<readonly SkillCatalogEntry[]> {
    return this.skills.map((skill) => ({ id: skill.id, triggerSummary: skill.triggerSummary }));
  }

  /** Stage-1 `shouldActivate` over every loaded skill, excluding ones
   * already active this session (`ctx.activeSkillIds`) — progressive
   * disclosure: a matched skill's full body is returned for injection,
   * once. */
  async activate(ctx: SkillActivationContext): Promise<readonly SkillActivation[]> {
    return this.skills
      .filter((skill) => !ctx.activeSkillIds.has(skill.id) && skill.shouldActivate(ctx))
      .map((skill) => ({ id: skill.id, body: skill.body }));
  }

  /** §4.4 trigger condition #2: "no matching entry... via recommendedToolIds
   * sequence similarity" — exact ordered-array equality (design doc filled gap #4).
   * An empty query, or a skill that declared no sequence at all (the common
   * case — the PRD's own worked SKILL.md example never sets this field),
   * never counts as a match: two empty arrays are trivially "equal," but a
   * skill that didn't declare a tool sequence hasn't actually claimed to
   * cover anything. */
  async hasMatchingSkill(toolIds: readonly string[]): Promise<boolean> {
    if (toolIds.length === 0) return false;
    return this.skills.some(
      (skill) => skill.recommendedToolIds.length > 0 && recommendedToolIdsEqual(skill.recommendedToolIds, toolIds),
    );
  }

  /** Delegates to the free `evaluateDraft` function — a method here purely
   * so `SkillCatalog` is the single object that satisfies all of
   * `SkillsPort`, same shape as `MemoryStore`. */
  async evaluateDraft(rawDraftText: string): Promise<SkillDraftEvaluation> {
    return evaluateDraft(rawDraftText);
  }
}
