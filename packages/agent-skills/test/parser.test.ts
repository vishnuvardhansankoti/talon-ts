import { describe, expect, it } from "@jest/globals";
import { parseSkillFile } from "../src/parser/skill-parser.js";

const VALID = `---
id: skill.run_tests
trigger_summary: "Run the project's test suite"
origin: human
---
# Run Tests
1. Run \`shell.exec\` with \`npm test\`.
`;

describe("parseSkillFile", () => {
  it("parses a valid SKILL.md, stripping quotes from quoted frontmatter values", () => {
    const parsed = parseSkillFile(VALID);
    expect(parsed).toMatchObject({
      id: "skill.run_tests",
      triggerSummary: "Run the project's test suite",
      origin: "human",
    });
    expect(parsed?.body).toContain("# Run Tests");
  });

  it("defaults origin to \"human\" when absent", () => {
    const text = `---
id: skill.x
trigger_summary: x
---
body`;
    expect(parseSkillFile(text)?.origin).toBe("human");
  });

  it("parses synthesized-only fields (source_session_id, confidence)", () => {
    const text = `---
id: skill.deploy_preview_branch
trigger_summary: "Deploy a preview"
origin: synthesized
source_session_id: 9f2e
confidence: 0.82
---
body`;
    const parsed = parseSkillFile(text);
    expect(parsed).toMatchObject({ origin: "synthesized", sourceSessionId: "9f2e", confidence: 0.82 });
  });

  it("parses recommended_tool_ids as a comma-separated list", () => {
    const text = `---
id: skill.x
trigger_summary: x
recommended_tool_ids: fs.read_file, shell.exec
---
body`;
    expect(parseSkillFile(text)?.recommendedToolIds).toEqual(["fs.read_file", "shell.exec"]);
  });

  it("returns undefined (never throws) when id is missing", () => {
    const text = `---
trigger_summary: x
---
body`;
    expect(parseSkillFile(text)).toBeUndefined();
  });

  it("returns undefined (never throws) when trigger_summary is missing", () => {
    const text = `---
id: skill.x
---
body`;
    expect(parseSkillFile(text)).toBeUndefined();
  });

  it("returns undefined for a file with no frontmatter at all", () => {
    expect(parseSkillFile("just plain text, no frontmatter")).toBeUndefined();
  });
});
