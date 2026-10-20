import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeCompactionPlan, type CompactionCandidate } from "../compaction/compaction-plan.js";
import { archiveEntry, getReferenceCount, incrementReferenceCount, type SqliteDatabase } from "../fts/sqlite-store.js";
import { parseFrontmatter, serializeFrontmatter } from "../profile/frontmatter.js";
import { type EpisodicEntry, formatEntry, hashEntry, parseEntries, parseMaxEntries, scoreByKeywordOverlap } from "./entry.js";

const DEFAULT_HEADER = "# Episodic Memory";

export interface EpisodicSnapshot {
  readonly entries: readonly EpisodicEntry[];
  readonly maxEntries: number;
}

/** Tier 2 (§4.2): MEMORY.md, a rolling log of durable cross-session facts. */
export class EpisodicStore {
  private readonly filePath: string;

  constructor(private readonly db: SqliteDatabase, projectRoot: string) {
    this.filePath = path.join(projectRoot, ".talon", "MEMORY.md");
  }

  async load(): Promise<EpisodicSnapshot> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { entries: [], maxEntries: parseMaxEntries({}) };
      }
      throw error;
    }
    const { frontmatter, body } = parseFrontmatter(raw);
    return { entries: parseEntries(body), maxEntries: parseMaxEntries(frontmatter) };
  }

  /** Keyword-overlap recall (design decision #4) against the current
   * entries; every returned entry's `memory_reference_counts` row is
   * incremented — the proxy for §4.2's "influences a plan" scoring input
   * (design decision #3). */
  async recall(query: string, limit: number): Promise<string[]> {
    const { entries } = await this.load();
    const scored = entries
      .map((entry) => ({ entry, score: scoreByKeywordOverlap(query, entry.text) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    for (const { entry } of scored) {
      incrementReferenceCount(this.db, entry.hash);
    }
    return scored.map(({ entry }) => entry.text);
  }

  getReferenceCount(entryHash: string): number {
    return getReferenceCount(this.db, entryHash);
  }

  /** Appends a new entry dated today. Called only by `compaction/`'s
   * merge-logging step (§4.2 point 4) — nothing else in this pass
   * auto-writes MEMORY.md entries. */
  async append(text: string): Promise<void> {
    await this.writeEntries([...((await this.load()).entries), { date: todayDate(), text, hash: "" }]);
  }

  /**
   * §4.2 compaction: runs the pure algorithm against the current entries
   * (each annotated with its tracked reference count), and — only when it
   * actually produces something to prune — archives the pruned originals
   * (linked via `merged_into` to the new summary entry's hash) and rewrites
   * MEMORY.md as kept entries + newly appended merge summaries. Returns
   * whether compaction ran.
   */
  async compactIfNeeded(): Promise<boolean> {
    const { entries, maxEntries } = await this.load();
    const candidates: CompactionCandidate[] = entries.map((entry) => ({
      date: entry.date,
      text: entry.text,
      hash: entry.hash,
      referenceCount: this.getReferenceCount(entry.hash),
    }));
    const plan = computeCompactionPlan(candidates, maxEntries);
    if (plan.archived.length === 0) return false;

    const today = todayDate();
    const archivedByHash = new Map(plan.archived.map((entry) => [entry.hash, entry]));

    for (const summary of plan.merged) {
      const summaryHash = hashEntry(today, summary.text);
      for (const sourceHash of summary.sourceHashes) {
        const original = archivedByHash.get(sourceHash);
        if (original !== undefined) archiveEntry(this.db, randomUUID(), original.text, summaryHash);
      }
    }

    await this.writeEntries([
      ...plan.kept.map((entry) => ({ date: entry.date, text: entry.text })),
      ...plan.merged.map((summary) => ({ date: today, text: summary.text })),
    ]);
    return true;
  }

  async writeEntries(entries: readonly Pick<EpisodicEntry, "date" | "text">[]): Promise<void> {
    const { maxEntries } = await this.load();
    const body = `${DEFAULT_HEADER}\n\n${entries.map(formatEntry).join("\n")}\n`;
    const content = serializeFrontmatter({ schema_version: "1", max_entries: String(maxEntries) }, body);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, content, "utf8");
  }
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}
