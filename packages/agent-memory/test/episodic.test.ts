import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "@jest/globals";
import { EpisodicStore } from "../src/episodic/episodic-store.js";
import { hashEntry } from "../src/episodic/entry.js";
import { getReferenceCount, openDatabase, type SqliteDatabase } from "../src/fts/sqlite-store.js";

let db: SqliteDatabase | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

async function makeStore(): Promise<EpisodicStore> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "talon-memory-episodic-"));
  db = openDatabase(path.join(projectRoot, "memory.db"));
  return new EpisodicStore(db, projectRoot);
}

describe("EpisodicStore", () => {
  it("returns an empty snapshot when MEMORY.md doesn't exist yet", async () => {
    const store = await makeStore();
    const { entries, maxEntries } = await store.load();
    expect(entries).toEqual([]);
    expect(maxEntries).toBe(200);
  });

  it("round-trips writeEntries/load, parsing date+text per entry", async () => {
    const store = await makeStore();
    await store.writeEntries([
      { date: "2026-09-01", text: "Project talon uses pnpm workspaces and Turborepo." },
      { date: "2026-09-05", text: "User prefers rg over grep for all searches." },
    ]);

    const { entries } = await store.load();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ date: "2026-09-01", text: "Project talon uses pnpm workspaces and Turborepo." });
    expect(entries[0]?.hash).toBe(hashEntry("2026-09-01", "Project talon uses pnpm workspaces and Turborepo."));
  });

  it("append() adds a new entry dated today without disturbing existing ones", async () => {
    const store = await makeStore();
    await store.writeEntries([{ date: "2026-09-01", text: "existing fact" }]);
    await store.append("newly learned fact");

    const { entries } = await store.load();
    expect(entries.map((e) => e.text)).toEqual(["existing fact", "newly learned fact"]);
  });

  it("recall() scores by keyword overlap and increments reference counts for returned entries only", async () => {
    const store = await makeStore();
    await store.writeEntries([
      { date: "2026-09-01", text: "The daemon talond listens on a unix socket." },
      { date: "2026-09-02", text: "CLI auto-spawns talond if not already running." },
      { date: "2026-09-03", text: "Weather today is sunny with a light breeze." },
    ]);

    const recalled = await store.recall("talond unix socket", 2);
    expect(recalled).toEqual([
      "The daemon talond listens on a unix socket.",
      "CLI auto-spawns talond if not already running.",
    ]);

    const { entries } = await store.load();
    const socketEntry = entries.find((e) => e.text.includes("unix socket"));
    const weatherEntry = entries.find((e) => e.text.includes("Weather"));
    expect(socketEntry).toBeDefined();
    expect(weatherEntry).toBeDefined();
    expect(store.getReferenceCount(socketEntry!.hash)).toBe(1);
    expect(store.getReferenceCount(weatherEntry!.hash)).toBe(0);
  });

  it("recall() returns nothing for a query with zero keyword overlap", async () => {
    const store = await makeStore();
    await store.writeEntries([{ date: "2026-09-01", text: "Project talon uses pnpm workspaces." }]);
    expect(await store.recall("completely unrelated query terms", 5)).toEqual([]);
  });

  it("getReferenceCount matches the shared fts/sqlite-store accessor", async () => {
    const store = await makeStore();
    await store.writeEntries([{ date: "2026-09-01", text: "talond unix socket detail" }]);
    await store.recall("talond socket", 5);

    const { entries } = await store.load();
    const hash = entries[0]!.hash;
    expect(store.getReferenceCount(hash)).toBe(getReferenceCount(db!, hash));
  });
});
