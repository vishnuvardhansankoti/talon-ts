import { describe, expect, it } from "@jest/globals";
import { computeCompactionPlan, type CompactionCandidate } from "../src/compaction/compaction-plan.js";

const NOW = new Date("2026-10-13T00:00:00.000Z");

function candidate(date: string, text: string, referenceCount: number): CompactionCandidate {
  return { date, text, hash: `${date}:${text}`, referenceCount };
}

describe("computeCompactionPlan", () => {
  it("is a no-op when entries don't exceed maxEntries", () => {
    const entries = [candidate("2026-01-01", "a", 0), candidate("2026-01-02", "b", 0)];
    const plan = computeCompactionPlan(entries, 10, NOW);
    expect(plan).toEqual({ kept: entries, archived: [], merged: [] });
  });

  it("never drops an entry — every input ends up in exactly kept or archived", () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      candidate(`2026-01-${String(i + 1).padStart(2, "0")}`, `fact number ${i}`, i),
    );
    const plan = computeCompactionPlan(entries, 10, NOW);

    const accountedFor = new Set([...plan.kept.map((e) => e.hash), ...plan.archived.map((e) => e.hash)]);
    expect(accountedFor.size).toBe(entries.length);
    for (const entry of entries) {
      expect(accountedFor.has(entry.hash)).toBe(true);
    }
  });

  it("prunes roughly the lowest-scoring 20% (old date, low reference count)", () => {
    // 10 entries, same recency, reference counts 0..9 — the two lowest
    // (0 and 1) should be the prune candidates for a 20% cutoff.
    const entries = Array.from({ length: 10 }, (_, i) => candidate("2026-10-13", `entry ${i}`, i));
    const plan = computeCompactionPlan(entries, 5, NOW);

    expect(plan.archived.map((e) => e.text).sort()).toEqual(["entry 0", "entry 1"].sort());
    expect(plan.kept).toHaveLength(8);
  });

  it("scores older entries lower than newer ones at equal reference count", () => {
    // 6 entries, maxEntries=5 -> cutoffCount = max(1, floor(6*0.2)) = 1, so
    // exactly the single lowest-scoring entry gets pruned. "very old fact"
    // and "recent fact" share the same reference count (5); the 4 fillers
    // have a much higher one so they're never candidates — isolating recency
    // as the only variable that should decide which of the two gets pruned.
    const entries = [
      candidate("2020-01-01", "very old fact", 5),
      candidate("2026-10-12", "recent fact", 5),
      ...Array.from({ length: 4 }, (_, i) => candidate("2026-10-13", `filler ${i}`, 100)),
    ];
    const plan = computeCompactionPlan(entries, 5, NOW);

    expect(plan.archived.map((e) => e.text)).toEqual(["very old fact"]);
    expect(plan.kept.map((e) => e.text)).toContain("recent fact");
  });

  it("merges archived entries sharing a dominant keyword into one summary", () => {
    const entries = [
      candidate("2026-01-01", "talon uses pnpm workspaces", 0),
      candidate("2026-01-02", "talon also uses turborepo", 0),
      candidate("2026-01-03", "weather was sunny yesterday", 0),
      ...Array.from({ length: 7 }, (_, i) => candidate("2026-10-13", `filler ${i}`, 100)),
    ];
    const plan = computeCompactionPlan(entries, 5, NOW);

    // Every archived entry's hash must appear in exactly one merged summary's sourceHashes.
    const archivedHashes = new Set(plan.archived.map((e) => e.hash));
    const summarizedHashes = new Set(plan.merged.flatMap((m) => m.sourceHashes));
    expect(summarizedHashes).toEqual(archivedHashes);
  });

  it("produces a trivial single-entry summary for a singleton cluster", () => {
    const entries = [
      candidate("2026-01-01", "a uniquely worded fact about zephyrs", 0),
      ...Array.from({ length: 9 }, (_, i) => candidate("2026-10-13", `filler ${i}`, 100)),
    ];
    const plan = computeCompactionPlan(entries, 5, NOW);

    expect(plan.archived).toHaveLength(2); // 20% of 10
    const singleton = plan.merged.find((m) => m.sourceHashes.length === 1);
    expect(singleton).toBeDefined();
  });
});
