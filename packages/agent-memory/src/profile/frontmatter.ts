/**
 * Minimal hand-rolled frontmatter for USER.md/MEMORY.md — both only ever
 * carry a couple of flat scalar fields (schema_version, updated_at,
 * max_entries), so a real YAML parser would be a dependency for two key:
 * value lines. Not a general YAML parser: values are plain strings, one
 * `key: value` per line, no nesting/lists/quoting rules.
 */
const DELIMITER = "---";

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
    const value = line.slice(separatorIndex + 1).trim();
    if (key.length > 0) frontmatter[key] = value;
  }

  const body = lines
    .slice(endIndex + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return { frontmatter, body };
}

export function serializeFrontmatter(frontmatter: Readonly<Record<string, string>>, body: string): string {
  const header = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `${DELIMITER}\n${header}\n${DELIMITER}\n${body}`;
}

/** Same chars/4 heuristic `agent-core`'s `ContextBuilder.estimateTokens()`
 * uses (no shared import — agent-memory has no dependency on agent-core —
 * but a second, differently-calibrated estimator here would make the
 * 2,000-token USER.md cap (§4.1) inconsistent with how the loop budgets
 * context, so the formula itself is kept identical). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
