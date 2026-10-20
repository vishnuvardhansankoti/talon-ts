import { tokenize } from "../episodic/entry.js";

export interface CompactionCandidate {
  readonly date: string;
  readonly text: string;
  readonly hash: string;
  readonly referenceCount: number;
}

export interface MergedSummary {
  readonly text: string;
  readonly sourceHashes: readonly string[];
}

export interface CompactionPlan {
  readonly kept: readonly CompactionCandidate[];
  readonly archived: readonly CompactionCandidate[];
  readonly merged: readonly MergedSummary[];
}

/** No exact formula given by PRD §4.2 beyond "recency_weight * reference_count"
 * — this pass uses a simple inverse-age decay (today = 1.0, falling off as
 * 1/(1+days)), documented here since it's a filled gap, not literal spec. */
function recencyWeight(date: string, now: Date): number {
  const ageMs = now.getTime() - new Date(date).getTime();
  const ageDays = Math.max(0, ageMs / (24 * 60 * 60 * 1000));
  return 1 / (1 + ageDays);
}

/** First distinct non-stopword token, used as a cheap "topic" key for
 * clustering (§4.2: "simple keyword clustering, not embedding-based, to
 * stay dependency-light") — entries are short (~30 tokens), so a real
 * frequency count buys little over "first keyword mentioned." */
function dominantKeyword(text: string): string {
  const [first] = tokenize(text);
  return first ?? text;
}

/**
 * Pure §4.2 compaction algorithm: no I/O, independently testable. Only
 * produces a non-trivial plan when `entries.length > maxEntries` — callers
 * (`episodic/`) gate the actual archive-write + MEMORY.md-append I/O on
 * `plan.archived.length > 0`. Every input entry ends up in exactly one of
 * `kept`/`archived` — nothing is ever silently dropped.
 */
export function computeCompactionPlan(
  entries: readonly CompactionCandidate[],
  maxEntries: number,
  now: Date = new Date(),
): CompactionPlan {
  if (entries.length <= maxEntries) {
    return { kept: entries, archived: [], merged: [] };
  }

  const scored = entries.map((entry) => ({ entry, score: recencyWeight(entry.date, now) * entry.referenceCount }));
  const sortedAscending = [...scored].sort((a, b) => a.score - b.score);
  const cutoffCount = Math.max(1, Math.floor(sortedAscending.length * 0.2));
  const pruneHashes = new Set(sortedAscending.slice(0, cutoffCount).map((s) => s.entry.hash));

  const kept = entries.filter((entry) => !pruneHashes.has(entry.hash));
  const archived = entries.filter((entry) => pruneHashes.has(entry.hash));

  const clusters = new Map<string, CompactionCandidate[]>();
  for (const entry of archived) {
    const key = dominantKeyword(entry.text);
    const bucket = clusters.get(key) ?? [];
    bucket.push(entry);
    clusters.set(key, bucket);
  }

  const merged: MergedSummary[] = [...clusters.values()].map((members) => ({
    text: members.length === 1 ? members[0]!.text : members.map((m) => m.text).join("; "),
    sourceHashes: members.map((m) => m.hash),
  }));

  return { kept, archived, merged };
}
