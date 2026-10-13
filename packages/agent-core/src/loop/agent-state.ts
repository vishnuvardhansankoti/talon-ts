// PRD §3.1 — discriminated union + switch, not XState (design-review decision).

export type AgentState =
  | { readonly kind: "OBSERVE" }
  | { readonly kind: "PLAN" }
  | { readonly kind: "PRE_APPROVAL" }
  | { readonly kind: "ACT" }
  | { readonly kind: "VERIFY" }
  | { readonly kind: "LEARN" }
  | { readonly kind: "COMPACT" };

export type LoopTransitionEvent =
  | { readonly type: "APPROVAL_GRANTED" }
  | { readonly type: "APPROVAL_DENIED_REPLAN" }
  | { readonly type: "APPROVAL_DENIED_ABORT" }
  | { readonly type: "VERIFY_PASSED" }
  | { readonly type: "VERIFY_FAILED_RETRY" }
  | { readonly type: "VERIFY_FAILED_EXHAUSTED" }
  | { readonly type: "MORE_TURNS" }
  | { readonly type: "SESSION_END" };

export function transition(state: AgentState, event: LoopTransitionEvent): AgentState {
  switch (state.kind) {
    case "PRE_APPROVAL":
      switch (event.type) {
        case "APPROVAL_GRANTED":
          return { kind: "ACT" };
        case "APPROVAL_DENIED_REPLAN":
          return { kind: "PLAN" };
        case "APPROVAL_DENIED_ABORT":
          return { kind: "COMPACT" };
        default:
          throw new Error(`invalid event ${event.type} for PRE_APPROVAL`);
      }
    case "VERIFY":
      switch (event.type) {
        case "VERIFY_PASSED":
          return { kind: "LEARN" };
        case "VERIFY_FAILED_RETRY":
          return { kind: "PLAN" };
        case "VERIFY_FAILED_EXHAUSTED":
          return { kind: "COMPACT" };
        default:
          throw new Error(`invalid event ${event.type} for VERIFY`);
      }
    case "COMPACT":
      switch (event.type) {
        case "MORE_TURNS":
          return { kind: "OBSERVE" };
        case "SESSION_END":
          return state;
        default:
          throw new Error(`invalid event ${event.type} for COMPACT`);
      }
    default:
      throw new Error(`no event-driven transition defined for ${state.kind}`);
  }
}
