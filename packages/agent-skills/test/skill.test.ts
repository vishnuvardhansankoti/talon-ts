import { describe, expect, it } from "@jest/globals";
import { MarkdownSkill } from "../src/skill.js";

function makeSkill(triggerSummary: string, recommendedToolIds: string[] = []): MarkdownSkill {
  return new MarkdownSkill({
    id: "skill.test",
    triggerSummary,
    body: "body text",
    origin: "human",
    recommendedToolIds,
  });
}

describe("MarkdownSkill.shouldActivate", () => {
  it("activates on keyword overlap between triggerSummary and userIntentSummary", () => {
    const skill = makeSkill("Run the project's test suite");
    expect(
      skill.shouldActivate({ userIntentSummary: "please run the tests", recentToolIds: [], activeSkillIds: new Set() }),
    ).toBe(true);
  });

  it("does not activate when there's no keyword overlap", () => {
    const skill = makeSkill("Run the project's test suite");
    expect(
      skill.shouldActivate({ userIntentSummary: "what's the weather today", recentToolIds: [], activeSkillIds: new Set() }),
    ).toBe(false);
  });

  it("exposes recommendedToolIds via the getter (overriding BaseSkill's default [])", () => {
    const skill = makeSkill("x", ["fs.read_file", "shell.exec"]);
    expect(skill.recommendedToolIds).toEqual(["fs.read_file", "shell.exec"]);
  });

  it("defaults recommendedToolIds to an empty array when the skill declares none", () => {
    const skill = makeSkill("x");
    expect(skill.recommendedToolIds).toEqual([]);
  });
});
