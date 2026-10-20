import type { MemoryPort, MemoryTurn } from "@talon/agent-core";

/**
 * Phase 3 (mobile) scope cut — mirrors Phase 1's own "no persistence yet"
 * cut for talond (phase-1.md §7), not a mobile-specific shortcut. Phase
 * 2's real memory tiers (`@talon/agent-memory`) are built on
 * better-sqlite3, a native Node addon that doesn't run under Hermes; a
 * real mobile implementation needs expo-sqlite instead, gated on the PRD
 * §7.3 open risk ("confirm FTS5 ships in expo-sqlite... resolve before
 * Phase 3" — tracked, not yet resolved). Nothing here persists across app
 * restarts.
 */
export class NoopMobileMemory implements MemoryPort {
  async loadProfile(): Promise<string> {
    return "";
  }

  async recallEpisodic(): Promise<readonly string[]> {
    return [];
  }

  async compact(_turns: readonly MemoryTurn[], _sessionEnding: boolean): Promise<void> {}
}
