/**
 * Same keyword-overlap technique already used for `agent-memory`'s
 * episodic recall (`agent-memory/src/episodic/entry.ts`) — reused here
 * for `MarkdownSkill.shouldActivate`'s generic Stage-1 match (design doc
 * filled gap #2) rather than inventing a second heuristic. Not shared via
 * import: `agent-skills` depends on nothing but `agent-core`.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was",
  "were", "with", "at", "by", "this", "that", "it", "as", "be", "has", "have",
]);

export function tokenize(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((w) => !STOPWORDS.has(w) && w.length > 1));
}

export function scoreByKeywordOverlap(query: string, text: string): number {
  const queryTokens = tokenize(query);
  const textTokens = tokenize(text);
  let overlap = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) overlap += 1;
  }
  return overlap;
}
