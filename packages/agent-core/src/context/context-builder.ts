import type { Message } from "../shared/ports.js";

/**
 * System prompt + turn history, with a sliding-window trim standing in for
 * real §4.2 compaction (real MEMORY.md compaction runs separately, inside
 * `MemoryPort.compact` — this trim just bounds the live message list the
 * provider sees). `agent-skills`' SKILL.md catalog (§2.2) still isn't wired
 * in here — that's Pass 2 of Phase 2.
 */
export class ContextBuilder {
  private turns: Message[] = [];
  private extraSystemContext: string[] = [];

  constructor(private readonly systemPrompt: string) {}

  addTurn(turn: Message): void {
    this.turns.push(turn);
  }

  /** Folds additional text into the system message — e.g. a loaded
   * USER.md profile (§4.1). Generic string-append; stays agnostic of
   * where the text came from. */
  prependSystemContext(text: string): void {
    this.extraSystemContext.push(text);
  }

  buildMessages(): Message[] {
    const system = [this.systemPrompt, ...this.extraSystemContext].join("\n\n");
    return [{ role: "system", content: system }, ...this.turns];
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
