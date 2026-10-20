import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export type SqliteDatabase = InstanceType<typeof Database>;

export interface MemoryTurn {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolId?: string;
}

export interface SearchHit {
  readonly turnId: string;
  readonly content: string;
}

/**
 * PRD §4.3 schema, verbatim, plus one table not in the PRD:
 * `memory_reference_counts` tracks how often a MEMORY.md entry (identified
 * by a stable hash of its text) has been retrieved and folded into context
 * — the proxy this package uses for §4.2's "reference_count" scoring input,
 * since the PRD doesn't specify the retrieval/counting mechanism precisely
 * and true "influenced a plan" causality isn't observable from here.
 */
export function openDatabase(path: string): SqliteDatabase {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
}

export function initSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id   TEXT PRIMARY KEY,
      started_at   INTEGER NOT NULL,
      ended_at     INTEGER,
      platform     TEXT NOT NULL,
      provider_id  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turns (
      turn_id      TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL REFERENCES sessions(session_id),
      turn_index   INTEGER NOT NULL,
      role         TEXT NOT NULL,
      content      TEXT NOT NULL,
      tool_id      TEXT,
      created_at   INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
      content,
      content='turns',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns BEGIN
      INSERT INTO turns_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS turns_ad AFTER DELETE ON turns BEGIN
      INSERT INTO turns_fts(turns_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS turns_au AFTER UPDATE ON turns BEGIN
      INSERT INTO turns_fts(turns_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO turns_fts(rowid, content) VALUES (new.rowid, new.content);
    END;

    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id   TEXT PRIMARY KEY,
      turn_id       TEXT NOT NULL REFERENCES turns(turn_id),
      mime_type     TEXT NOT NULL,
      file_path     TEXT NOT NULL,
      size_bytes    INTEGER NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_archive (
      entry_id      TEXT PRIMARY KEY,
      archived_at   INTEGER NOT NULL,
      original_text TEXT NOT NULL,
      merged_into   TEXT
    );

    CREATE TABLE IF NOT EXISTS skills_synthesized (
      skill_id           TEXT PRIMARY KEY,
      created_at         INTEGER NOT NULL,
      status             TEXT NOT NULL,
      source_session_id  TEXT NOT NULL REFERENCES sessions(session_id)
    );

    CREATE TABLE IF NOT EXISTS memory_reference_counts (
      entry_hash TEXT PRIMARY KEY,
      count      INTEGER NOT NULL
    );
  `);
}

export function startSession(db: SqliteDatabase, platform: string, providerId: string): string {
  const sessionId = randomUUID();
  db.prepare("INSERT INTO sessions (session_id, started_at, ended_at, platform, provider_id) VALUES (?, ?, NULL, ?, ?)").run(
    sessionId,
    Date.now(),
    platform,
    providerId,
  );
  return sessionId;
}

export function recordTurns(
  db: SqliteDatabase,
  sessionId: string,
  startIndex: number,
  turns: readonly MemoryTurn[],
): void {
  const insert = db.prepare(
    "INSERT INTO turns (turn_id, session_id, turn_index, role, content, tool_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertMany = db.transaction((rows: readonly MemoryTurn[]) => {
    rows.forEach((turn, offset) => {
      insert.run(randomUUID(), sessionId, startIndex + offset, turn.role, turn.content, turn.toolId ?? null, Date.now());
    });
  });
  insertMany(turns);
}

export function endSession(db: SqliteDatabase, sessionId: string): void {
  db.prepare("UPDATE sessions SET ended_at = ? WHERE session_id = ?").run(Date.now(), sessionId);
}

export function searchTurns(db: SqliteDatabase, query: string, limit: number): SearchHit[] {
  const rows = db
    .prepare(
      "SELECT turns.turn_id AS turnId, turns.content AS content FROM turns_fts JOIN turns ON turns.rowid = turns_fts.rowid WHERE turns_fts MATCH ? ORDER BY rank LIMIT ?",
    )
    .all(query, limit) as SearchHit[];
  return rows;
}

export function incrementReferenceCount(db: SqliteDatabase, entryHash: string): void {
  db.prepare(
    "INSERT INTO memory_reference_counts (entry_hash, count) VALUES (?, 1) ON CONFLICT(entry_hash) DO UPDATE SET count = count + 1",
  ).run(entryHash);
}

export function getReferenceCount(db: SqliteDatabase, entryHash: string): number {
  const row = db.prepare("SELECT count FROM memory_reference_counts WHERE entry_hash = ?").get(entryHash) as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}

export function archiveEntry(db: SqliteDatabase, entryId: string, originalText: string, mergedInto: string | null): void {
  db.prepare("INSERT INTO memory_archive (entry_id, archived_at, original_text, merged_into) VALUES (?, ?, ?, ?)").run(
    entryId,
    Date.now(),
    originalText,
    mergedInto,
  );
}
