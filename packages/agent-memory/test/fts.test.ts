import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import {
  endSession,
  getReferenceCount,
  incrementReferenceCount,
  openDatabase,
  recordTurns,
  searchTurns,
  startSession,
} from "../src/fts/sqlite-store.js";

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "talon-memory-fts-"));
  return path.join(dir, "memory.db");
}

describe("fts/sqlite-store", () => {
  it("records turns and finds them via FTS5 MATCH", () => {
    const db = openDatabase(path.join(tmpdir(), `talon-fts-${Date.now()}-${Math.random()}.db`));
    try {
      const sessionId = startSession(db, "linux", "ollama");
      recordTurns(db, sessionId, 0, [
        { role: "user", content: "talon uses pnpm workspaces and turborepo" },
        { role: "assistant", content: "unrelated reply about weather" },
      ]);

      const hits = searchTurns(db, "pnpm", 10);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.content).toBe("talon uses pnpm workspaces and turborepo");
    } finally {
      db.close();
    }
  });

  it("keeps the FTS index in sync on turn update and delete via triggers", () => {
    const db = openDatabase(path.join(tmpdir(), `talon-fts-${Date.now()}-${Math.random()}.db`));
    try {
      const sessionId = startSession(db, "linux", "ollama");
      recordTurns(db, sessionId, 0, [{ role: "user", content: "original wording" }]);
      expect(searchTurns(db, "original", 10)).toHaveLength(1);

      db.prepare("UPDATE turns SET content = ? WHERE session_id = ?").run("updated wording", sessionId);
      expect(searchTurns(db, "original", 10)).toHaveLength(0);
      expect(searchTurns(db, "updated", 10)).toHaveLength(1);

      db.prepare("DELETE FROM turns WHERE session_id = ?").run(sessionId);
      expect(searchTurns(db, "updated", 10)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("tracks reference counts independently per entry hash", () => {
    const db = openDatabase(path.join(tmpdir(), `talon-fts-${Date.now()}-${Math.random()}.db`));
    try {
      expect(getReferenceCount(db, "hash-a")).toBe(0);
      incrementReferenceCount(db, "hash-a");
      incrementReferenceCount(db, "hash-a");
      incrementReferenceCount(db, "hash-b");
      expect(getReferenceCount(db, "hash-a")).toBe(2);
      expect(getReferenceCount(db, "hash-b")).toBe(1);
    } finally {
      db.close();
    }
  });

  it("sessions persist and are searchable across a close + reopen — the Phase 2 exit criterion (PRD §7.2)", async () => {
    const dbPath = await tempDbPath();

    const first = openDatabase(dbPath);
    const sessionId = startSession(first, "linux", "ollama");
    recordTurns(first, sessionId, 0, [{ role: "user", content: "remember this across a restart" }]);
    endSession(first, sessionId);
    first.close();

    const reopened = openDatabase(dbPath);
    try {
      const hits = searchTurns(reopened, "restart", 10);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.content).toBe("remember this across a restart");

      const session = reopened.prepare("SELECT ended_at FROM sessions WHERE session_id = ?").get(sessionId) as {
        ended_at: number | null;
      };
      expect(session.ended_at).not.toBeNull();
    } finally {
      reopened.close();
    }
  });
});
