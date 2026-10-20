import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import { SkillCatalog } from "../src/catalog/skill-catalog.js";

async function tempProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "talon-skills-catalog-"));
}

async function writeProjectSkill(projectRoot: string, filename: string, content: string): Promise<void> {
  const dir = path.join(projectRoot, ".talon", "skills");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), content, "utf8");
}

describe("SkillCatalog", () => {
  it("loads the bundled skill (packages/agent-skills/skills/run-tests.md) with no project skills present", async () => {
    const catalog = await SkillCatalog.open(await tempProjectRoot());
    const entries = await catalog.listCatalog();
    expect(entries.some((e) => e.id === "skill.run_tests")).toBe(true);
  });

  it("loads project-root skills alongside the bundled one", async () => {
    const projectRoot = await tempProjectRoot();
    await writeProjectSkill(
      projectRoot,
      "deploy.md",
      '---\nid: skill.deploy_staging\ntrigger_summary: "Deploy the staging environment"\norigin: human\n---\nbody',
    );

    const catalog = await SkillCatalog.open(projectRoot);
    const ids = (await catalog.listCatalog()).map((e) => e.id);
    expect(ids).toContain("skill.run_tests");
    expect(ids).toContain("skill.deploy_staging");
  });

  it("skips a malformed skill file (SKILL_PARSE_ERROR) without crashing the catalog load", async () => {
    const projectRoot = await tempProjectRoot();
    await writeProjectSkill(projectRoot, "broken.md", "---\ntrigger_summary: missing the id field\n---\nbody");
    await writeProjectSkill(
      projectRoot,
      "good.md",
      '---\nid: skill.good_one\ntrigger_summary: "A valid skill"\norigin: human\n---\nbody',
    );

    const catalog = await SkillCatalog.open(projectRoot);
    const ids = (await catalog.listCatalog()).map((e) => e.id);
    expect(ids).toContain("skill.good_one");
    expect(ids).toHaveLength(2); // bundled run_tests + good_one; broken.md skipped
  });

  it("activate() returns the full body for a matching skill, excluding already-active ids", async () => {
    const catalog = await SkillCatalog.open(await tempProjectRoot());

    const first = await catalog.activate({
      userIntentSummary: "please run the test suite",
      recentToolIds: [],
      activeSkillIds: new Set(),
    });
    expect(first.map((a) => a.id)).toEqual(["skill.run_tests"]);
    expect(first[0]?.body).toContain("Run Tests");

    const second = await catalog.activate({
      userIntentSummary: "please run the test suite",
      recentToolIds: [],
      activeSkillIds: new Set(["skill.run_tests"]),
    });
    expect(second).toEqual([]);
  });

  it("hasMatchingSkill() does exact ordered recommendedToolIds comparison", async () => {
    const projectRoot = await tempProjectRoot();
    await writeProjectSkill(
      projectRoot,
      "combo.md",
      '---\nid: skill.combo\ntrigger_summary: "A combo skill"\norigin: human\nrecommended_tool_ids: fs.read_file, shell.exec\n---\nbody',
    );
    const catalog = await SkillCatalog.open(projectRoot);

    expect(await catalog.hasMatchingSkill(["fs.read_file", "shell.exec"])).toBe(true);
    expect(await catalog.hasMatchingSkill(["shell.exec", "fs.read_file"])).toBe(false); // order matters
    expect(await catalog.hasMatchingSkill(["fs.read_file"])).toBe(false);
    expect(await catalog.hasMatchingSkill([])).toBe(false);
  });

  it("evaluateDraft() delegates to the synthesizer's confidence gate", async () => {
    const catalog = await SkillCatalog.open(await tempProjectRoot());
    const accepted = await catalog.evaluateDraft(
      '---\nid: skill.x\ntrigger_summary: "x"\norigin: synthesized\nconfidence: 0.9\n---\nbody',
    );
    expect(accepted.accepted).toBe(true);

    const rejected = await catalog.evaluateDraft(
      '---\nid: skill.x\ntrigger_summary: "x"\norigin: synthesized\nconfidence: 0.1\n---\nbody',
    );
    expect(rejected.accepted).toBe(false);
  });
});
