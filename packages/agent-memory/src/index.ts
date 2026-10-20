import { mkdir } from "node:fs/promises";
import path from "node:path";
import { EpisodicStore } from "./episodic/episodic-store.js";
import {
  endSession,
  openDatabase,
  recordTurns,
  searchTurns,
  startSession,
  type MemoryTurn,
  type SearchHit,
  type SqliteDatabase,
} from "./fts/sqlite-store.js";
import { ProfileWriter } from "./profile/profile-writer.js";

export type { MemoryTurn, SearchHit } from "./fts/sqlite-store.js";
export { ProfileCapExceededError } from "./profile/profile-writer.js";

/** Exactly `agent-core`'s `MemoryPort` shape — re-declared here rather than
 * imported (agent-memory has no dependency on agent-core; structural
 * typing is what makes a `MemorySession` satisfy the port). */
export interface MemorySession {
  loadProfile(): Promise<string>;
  recallEpisodic(query: string, limit: number): Promise<readonly string[]>;
  compact(turns: readonly MemoryTurn[], sessionEnding: boolean): Promise<void>;
}

function currentPlatform(): string {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

/**
 * Ties profile/episodic/fts/compaction together — one `MemoryStore` per
 * `talond` process, opening a single SQLite connection for the project's
 * `.talon/memory.db`. Session-scoped state (the `sessions` row, turn
 * index) does **not** live here: `apps/talond`'s `streamSession` handler
 * constructs a fresh `AgentLoop` per gRPC session (grpc-server.ts), and a
 * single shared `sessionId` here would wrongly merge every session's
 * turns into one `sessions` row. `createSession()` is the per-session
 * factory that mirrors that — call it once per `AgentLoop`, not once per
 * process.
 */
export class MemoryStore {
  private constructor(
    private readonly db: SqliteDatabase,
    private readonly profile: ProfileWriter,
    private readonly episodic: EpisodicStore,
    private readonly providerId: string,
  ) {}

  static async open(projectRoot: string, providerId = "unknown"): Promise<MemoryStore> {
    const talonDir = path.join(projectRoot, ".talon");
    await mkdir(talonDir, { recursive: true });
    const db = openDatabase(path.join(talonDir, "memory.db"));
    return new MemoryStore(db, new ProfileWriter(projectRoot), new EpisodicStore(db, projectRoot), providerId);
  }

  /** Tier 1 (§4.1), folded into the system prompt once per session. */
  async loadProfile(): Promise<string> {
    return (await this.profile.load()) ?? "";
  }

  /** Tier 2 (§4.2) recall for OBSERVE. */
  async recallEpisodic(query: string, limit: number): Promise<readonly string[]> {
    return this.episodic.recall(query, limit);
  }

  /**
   * One `MemorySession` per gRPC `streamSession` call (structurally
   * satisfies `agent-core`'s `MemoryPort` — `agent-core` never imports
   * this package). `loadProfile`/`recallEpisodic` delegate straight back
   * to the shared store; `compact` owns its own `sessionId`/turn-index
   * bookkeeping, per PRD §3.1's "session persistence to SQLite" being a
   * COMPACT-time action, not continuous — the `sessions` row is created
   * lazily on first call, and `ended_at` is only set when `sessionEnding`
   * (the gRPC session itself ending, not merely the current turn).
   */
  createSession(): MemorySession {
    let sessionId: string | undefined;
    let turnIndex = 0;

    return {
      loadProfile: () => this.loadProfile(),
      recallEpisodic: (query, limit) => this.recallEpisodic(query, limit),
      compact: async (turns, sessionEnding) => {
        if (sessionId === undefined) {
          sessionId = startSession(this.db, currentPlatform(), this.providerId);
        }
        if (turns.length > 0) {
          recordTurns(this.db, sessionId, turnIndex, turns);
          turnIndex += turns.length;
        }
        await this.episodic.compactIfNeeded();
        if (sessionEnding) {
          endSession(this.db, sessionId);
        }
      },
    };
  }

  /** Tier 3 full-text search over past turns (§4.3) — not part of
   * `MemoryPort` (agent-core's loop doesn't need it), but the literal
   * Phase 2 exit criterion ("sessions persist and are searchable across
   * talond restarts") is this, exposed for callers/tests that verify it. */
  search(query: string, limit: number): SearchHit[] {
    return searchTurns(this.db, query, limit);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
