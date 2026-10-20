import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "@jest/globals";
import { MemoryStore } from "../src/index.js";

let openStores: MemoryStore[] = [];

afterEach(async () => {
  await Promise.all(openStores.map((store) => store.close()));
  openStores = [];
});

async function openStore(projectRoot?: string): Promise<{ store: MemoryStore; projectRoot: string }> {
  const root = projectRoot ?? (await mkdtemp(path.join(tmpdir(), "talon-memory-store-")));
  const store = await MemoryStore.open(root, "ollama");
  openStores.push(store);
  return { store, projectRoot: root };
}

describe("MemoryStore", () => {
  it("loadProfile returns empty string when USER.md doesn't exist", async () => {
    const { store } = await openStore();
    expect(await store.loadProfile()).toBe("");
  });

  it("recallEpisodic returns nothing before any MEMORY.md entries exist", async () => {
    const { store } = await openStore();
    expect(await store.recallEpisodic("anything", 5)).toEqual([]);
  });

  it("a session's compact() persists turns that are searchable via store.search", async () => {
    const { store } = await openStore();
    const session = store.createSession();

    await session.compact(
      [
        { role: "user", content: "talon uses pnpm workspaces and turborepo" },
        { role: "assistant", content: "got it" },
      ],
      false,
    );
    await session.compact([], true);

    const hits = store.search("pnpm", 10);
    expect(hits).toHaveLength(1);
  });

  it("two sessions from the same store never share a sessions row", async () => {
    const { store } = await openStore();

    const sessionA = store.createSession();
    await sessionA.compact([{ role: "user", content: "message from session A" }], true);

    const sessionB = store.createSession();
    await sessionB.compact([{ role: "user", content: "message from session B" }], true);

    expect(store.search("session A", 10)).toHaveLength(1);
    expect(store.search("session B", 10)).toHaveLength(1);
  });

  it("session turns survive a close + reopen of the store (Phase 2 exit criterion)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "talon-memory-store-restart-"));
    const { store } = await openStore(root);
    const session = store.createSession();
    await session.compact([{ role: "user", content: "persisted across a daemon restart" }], true);
    await store.close();
    openStores = openStores.filter((s) => s !== store); // already closed, don't double-close in afterEach

    const { store: reopened } = await openStore(root);
    expect(reopened.search("restart", 10)).toHaveLength(1);
  });

  it("recallEpisodic surfaces entries written directly to MEMORY.md", async () => {
    const { store, projectRoot } = await openStore();
    // writeEntries() only touches the MEMORY.md file, not SQLite, so a
    // throwaway in-memory db is enough here — no need to share store's.
    const { EpisodicStore } = await import("../src/episodic/episodic-store.js");
    const { openDatabase } = await import("../src/fts/sqlite-store.js");
    const scratchDb = openDatabase(":memory:");
    const episodic = new EpisodicStore(scratchDb, projectRoot);
    await episodic.writeEntries([{ date: "2026-09-01", text: "talond listens on a unix socket" }]);
    scratchDb.close();

    const recalled = await store.recallEpisodic("talond unix socket", 5);
    expect(recalled).toEqual(["talond listens on a unix socket"]);
  });
});
