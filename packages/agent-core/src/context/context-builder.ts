import type { Message } from "../shared/ports.js";

/**
 * Phase 1 stand-in: no agent-memory, no SKILL.md catalog yet (PRD §4/§2.2
 * land in Phase 2+). This is just system prompt + turn history, with a
 * sliding-window trim standing in for real §4.2 compaction.
 */
export class ContextBuilder {
  private turns: Message[] = [];

  constructor(private readonly systemPrompt: string) {}

  addTurn(turn: Message): void {
    this.turns.push(turn);
  }

  buildMessages(): Message[] {
    return [{ role: "system", content: this.systemPrompt }, ...this.turns];
  }

  /** Naive chars/4 heuristic — good enough for a budget check, not real tokenization. */
  estimateTokens(): number {
    const chars = this.turns.reduce((total, turn) => total + turn.content.length, 0);
    return Math.ceil(chars / 4);
  }

  compact(maxTurns: number): void {
    if (this.turns.length > maxTurns) {
      this.turns = this.turns.slice(this.turns.length - maxTurns);
    }
  }
}
