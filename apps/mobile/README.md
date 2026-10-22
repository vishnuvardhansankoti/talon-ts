# @talon/mobile

The Expo (React Native) mobile shell. Unlike `@talon/cli`/`@talon/desktop`, this one doesn't talk to `talond` at all — Hermes can't host a Node daemon, so `@talon/agent-core`'s loop runs **in-process**, wired up in `src/agent/agent-session.ts` with mobile-only tool/approval/channel implementations and `GeminiProvider` (`@talon/agent-providers`) as the model provider. See [`docs/architecture/phase-3-mobile.md`](../../docs/architecture/phase-3-mobile.md) for the full design, including two portability fixes this phase made to `agent-core` itself, and a real "silent dead session" bug found by sending a live message against an invalid API key.

## Running it

```
cd apps/mobile
pnpm run start      # expo start — scan the QR code with Expo Go, or launch a simulator
pnpm run web        # expo start --web
```

On first launch, the app asks for a Gemini API key (stored via `expo-secure-store` — Keychain on iOS, Keystore on Android; `localStorage` only under `expo start --web`, which has no secure-storage backend). Get one at [Google AI Studio](https://aistudio.google.com/apikey) — PRD §1.1: this is always a user-supplied key talking directly to Google, never a vendor-operated proxy.

Type a message and send. `dangerousConfirmRequired` tool calls trigger a biometric prompt (Face ID / Touch ID / BiometricPrompt) via `expo-local-authentication`; `heuristicSandboxed` calls get a lightweight inline Approve/Deny banner instead.

## Typecheck

```
pnpm --filter @talon/mobile run typecheck
```

There's no `build` script — Metro bundles the app directly from TypeScript source at `start`/`web` time (via `babel-preset-expo`); `tsc` here is for type-checking only, same convention `tsconfig.json`'s `extends: "expo/tsconfig.base"` signals (this app is *not* part of the rest of the repo's `tsc -b` project-reference graph).

## Tests

```
cd apps/mobile && pnpm run test
```

Run standalone, not through the repo root's `pnpm test` — this app's own `jest.config.js` uses `jest-expo`'s babel-based transform (matching how Metro actually bundles it), not the `ts-jest` setup the rest of the monorepo shares, and nesting it into that shared multi-project config broke `@babel/runtime` module resolution in a way that only reproduced when run from there.

Covers `MobileChannel` (pure, no mocking needed), `MobileToolRegistry` (path-sandboxing rejections and tool dispatch, with `expo-file-system`/`react-native` mocked), `MobileApprovalGate` (all four tier/hardware/enrollment branches, with `expo-local-authentication` mocked), and `AgentSession`'s error handling — including the exact "session silently went dead after a provider error" bug §5 of the architecture doc describes, reproduced here with a mocked `fetch` rejecting `GeminiProvider`'s call.

## Tool subset

Only tools that make sense inside the app's OS sandbox are registered (`src/agent/mobile-tools.ts`) — no `shell.exec`, matching PRD §5.1's mobile row ("no raw shell access... limited to in-process, OS-mediated operations"):

| Tool | Tier | Notes |
|---|---|---|
| `device.info` | `safeReadOnly` | Platform/OS version, via `react-native`'s `Platform` |
| `fs.read_file` | `safeReadOnly` | Scoped to the app's sandboxed document directory (`expo-file-system`'s `Paths`/`File` API) |
| `fs.list_dir` | `safeReadOnly` | Same sandbox, via `Directory` |

## Verification status

This environment has no iOS/Android simulator tooling and no `adb` — everything here has been verified via `expo start --web` only (a real browser session: API key entry, a live network call to Gemini, state-machine transitions, and the error-handling path). Biometric prompts, `expo-secure-store`'s real Keychain/Keystore backend, and a genuine native build haven't been run on a device. See `docs/architecture/phase-3-mobile.md` §6 for the full list of what's unverified.

## Not yet implemented (later phases)

- Real persistence (`agent-memory`/`agent-skills` equivalents) — needs `expo-sqlite`, gated on PRD §7.3's open "confirm FTS5 ships in `expo-sqlite`" risk.
- On-device inference (Apple Foundation Models / LiteRT-LM Gemma) — Phase 4 scope; this app only ever talks to Gemini Cloud today.
- The full local → small-cloud → premium-cloud provider router (PRD §3.3).
