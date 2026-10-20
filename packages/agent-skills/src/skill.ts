import { scoreByKeywordOverlap } from "./keyword-overlap.js";
import type { ParsedSkill, SkillOrigin } from "./parser/skill-parser.js";

export type { SkillOrigin } from "./parser/skill-parser.js";

export interface SkillActivationContext {
  readonly userIntentSummary: string;
  readonly recentToolIds: readonly string[];
  readonly activeSkillIds: ReadonlySet<string>;
}

/** PRD §2.2, verbatim contract — one of the three named "Plugin Contracts". */
export abstract class BaseSkill {
  abstract readonly id: string;
  abstract readonly triggerSummary: string;
  abstract readonly body: string;
  abstract shouldActivate(ctx: SkillActivationContext): boolean;
  get recommendedToolIds(): readonly string[] {
    return [];
  }
  abstract readonly origin: SkillOrigin;
}

/**
 * The concrete (and in this pass, only) `BaseSkill` implementation: every
 * real skill is a parsed Markdown file, human-authored or synthesized —
 * neither can implement a custom `shouldActivate` TS method, so this
 * class gives every Markdown-sourced skill the same generic, pure,
 * I/O-free Stage-1 match (design doc filled gap #2): keyword overlap
 * between the skill's own `triggerSummary` and the turn's text.
 */
export class MarkdownSkill extends BaseSkill {
  readonly id: string;
  readonly triggerSummary: string;
  readonly body: string;
  readonly origin: SkillOrigin;
  private readonly _recommendedToolIds: readonly string[];

  constructor(parsed: ParsedSkill) {
    super();
    this.id = parsed.id;
    this.triggerSummary = parsed.triggerSummary;
    this.body = parsed.body;
    this.origin = parsed.origin;
    this._recommendedToolIds = parsed.recommendedToolIds;
  }

  override get recommendedToolIds(): readonly string[] {
    return this._recommendedToolIds;
  }

  shouldActivate(ctx: SkillActivationContext): boolean {
    return scoreByKeywordOverlap(ctx.userIntentSummary, this.triggerSummary) > 0;
  }
}
