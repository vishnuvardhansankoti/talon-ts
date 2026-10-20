import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * This package declares an `exports` map with only `"."` — so, unlike
 * `apps/cli`'s `require.resolve("@talon/talond/package.json")` (an *app*,
 * with no `exports` restriction at all), self-resolving
 * `@talon/agent-skills/package.json` by name would hit Node's strict
 * exports-based resolution and throw `ERR_PACKAGE_PATH_NOT_EXPORTED` —
 * `package.json` was never listed as an exported subpath. Deriving the
 * bundled `skills/` directory from this module's own file location
 * (`dist/loader/skill-files.js` → package root → `skills/`) sidesteps
 * that entirely and works regardless of how the package is linked.
 */
export function resolveBundledSkillsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "..", "skills");
}

/** Non-recursive `*.md` listing; an absent directory (e.g. a project with
 * no `.talon/skills/` yet) is not an error — just an empty catalog contribution. */
export async function listSkillFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names.filter((name) => name.endsWith(".md")).map((name) => path.join(dir, name));
}

export async function readSkillFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}
