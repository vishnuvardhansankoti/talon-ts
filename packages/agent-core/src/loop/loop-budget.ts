export interface LoopBudget {
  readonly maxTurnsPerSession: number;
  readonly maxToolCallsPerTurn: number;
  readonly maxContextTokens: number;
  readonly maxWallClockPerTurnMs: number;
  readonly maxVerifyRetries: number;
  /** Phase 1 addition, not in the PRD table: bounds PRE_APPROVAL denial->replan loops. */
  readonly maxDenialReplans: number;
}

export const defaultLoopBudget: LoopBudget = {
  maxTurnsPerSession: 40,
  maxToolCallsPerTurn: 8,
  maxContextTokens: 8192,
  maxWallClockPerTurnMs: 600_000,
  maxVerifyRetries: 2,
  maxDenialReplans: 3,
};
