/**
 * Minimal hand-rolled frontmatter — the same small format and parser
 * already used by `agent-memory/src/profile/frontmatter.ts` for USER.md/
 * MEMORY.md. Not shared via import: `agent-skills` depends on nothing but
 * `agent-core` (PRD §2.3), so this is its own small copy rather than a new
 * cross-package dependency for ~20 lines of code.
 */
const DELIMITER = "---";

/** PRD §4.4's own worked SKILL.md example quotes string values
 * (`trigger_summary: "..."`) YAML-style — strip one matching pair of
 * surrounding quotes so callers get the actual string, not a value with
 * literal quote characters still attached. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export interface ParsedFrontmatter {
  readonly frontmatter: Readonly<Record<string, string>>;
  readonly body: string;
}

export function parseFrontmatter(text: string): ParsedFrontmatter {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== DELIMITER) {
    return { frontmatter: {}, body: text };
  }

  const endIndex = lines.indexOf(DELIMITER, 1);
  if (endIndex === -1) {
    return { frontmatter: {}, body: text };
  }

  const frontmatter: Record<string, string> = {};
  for (const line of lines.slice(1, endIndex)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = unquote(line.slice(separatorIndex + 1).trim());
    if (key.length > 0) frontmatter[key] = value;
  }

  const body = lines
    .slice(endIndex + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return { frontmatter, body };
}
