import { describe, expect, it } from "@jest/globals";
import { evaluateDraft } from "../src/synthesizer/evaluate-draft.js";

function draft(confidence: string | undefined): string {
  const confidenceLine = confidence !== undefined ? `confidence: ${confidence}\n` : "";
  return `---
id: skill.deploy_preview_branch
trigger_summary: "Deploy a feature branch to a preview environment"
origin: synthesized
${confidenceLine}---
# Deploy Preview Branch
1. Run \`shell.exec\` with \`vercel deploy --prebuilt\`.
`;
}

describe("evaluateDraft", () => {
  it("accepts a draft at or above the 0.6 confidence threshold", () => {
    const result = evaluateDraft(draft("0.82"));
    expect(result).toMatchObject({ accepted: true, skillId: "skill.deploy_preview_branch" });
  });

  it("accepts a draft exactly at the threshold", () => {
    expect(evaluateDraft(draft("0.6")).accepted).toBe(true);
  });

  it("rejects a draft below the threshold", () => {
    const result = evaluateDraft(draft("0.4"));
    expect(result.accepted).toBe(false);
    expect(result.skillId).toBe("skill.deploy_preview_branch");
    expect(result.reason).toContain("below");
  });

  it("rejects a draft with no confidence field at all", () => {
    const result = evaluateDraft(draft(undefined));
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("no confidence field");
  });

  it("rejects a draft with an unparseable confidence value", () => {
    const result = evaluateDraft(draft("not-a-number"));
    expect(result.accepted).toBe(false);
  });

  it("rejects an unparseable draft (missing id/trigger_summary) without throwing", () => {
    const result = evaluateDraft("not even frontmatter, just prose the model produced instead");
    expect(result.accepted).toBe(false);
    expect(result.skillId).toBeUndefined();
  });
});
