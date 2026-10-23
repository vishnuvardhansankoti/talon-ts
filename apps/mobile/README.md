# @talon/mobile

The Expo (React Native) mobile shell. Unlike `@talon/cli`/`@talon/desktop`, this one doesn't talk to `talond` at all — Hermes can't host a Node daemon, so `@talon/agent-core`'s loop runs **in-process**, wired up in `src/agent/agent-session.ts` with mobile-only tool/approval/channel implementations and a model provider chosen at setup time (`@talon/agent-providers`'s `GeminiProvider` or `MobileOllamaProvider`). See [`docs/architecture/phase-3-mobile.md`](../../docs/architecture/phase-3-mobile.md) for the full design, including two portability fixes this phase made to `agent-core` itself, and a real "silent dead session" bug found by sending a live message against an invalid API key.

## Running it

```
cd apps/mobile
pnpm run start      # expo start — scan the QR code with Expo Go, or launch a simulator
pnpm run web        # expo start --web
```

On first launch, the app shows a settings screen to pick a model provider:

- **Gemini** — paste an API key from [Google AI Studio](https://aistudio.google.com/apikey). PRD §1.1: always a user-supplied key talking directly to Google, never a vendor-operated proxy.
- **Ollama** — "local" here means reachable over the phone's own LAN, not literally on-device (Ollama has no iOS/Android port); enter the base URL of a machine already running it (e.g. your laptop's LAN IP, like `http://192.168.1.50:11434` — never `localhost`) and the model tag to use. Uses `MobileOllamaProvider`, a non-streaming variant of `OllamaProvider` written specifically because Hermes has no `node:stream`/`node:crypto` — see that file's comment, and `gemini-provider.ts`'s, for the same constraint solved the same way for a different vendor.

Either way, the choice is stored via `expo-secure-store` (Keychain on iOS, Keystore on Android; `localStorage` only under `expo start --web`, which has no secure-storage backend). Switching providers later (the chat screen's "Change provider" button) requires closing and reopening the app — `AgentSession` wraps one long-lived `AgentLoop` for the app's whole lifetime, with no live teardown/reconnect path, so a provider change only takes effect on the next launch rather than hot-swapping mid-session.

Ollama reachability from a real device needs one more thing this phase also adds: `app.json`'s `ios.infoPlist.NSAppTransportSecurity.NSAllowsLocalNetworking` and `android.usesCleartextTraffic`, both `true` — without them, a real iOS/Android build silently can't reach a plain-`http://` LAN address (this doesn't affect `expo start --web`, which has no such restriction).

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

Covers `MobileChannel` (pure, no mocking needed), `MobileToolRegistry` (path-sandboxing rejections and tool dispatch, with `expo-file-system`/`react-native` mocked), `createWebSearchTool` (Tavily request shape, response mapping, error paths, all via a mocked `fetch`), `MobileApprovalGate` (all four tier/hardware/enrollment branches, with `expo-local-authentication` mocked), `provider-settings`/`tavily-settings`'s SecureStore/localStorage round-trips, `isValidOllamaBaseUrl`, and `AgentSession`'s error handling — including the exact "session silently went dead after a provider error" bug §5 of the architecture doc describes, reproduced here with a mocked `fetch` rejecting `GeminiProvider`'s call. `MobileOllamaProvider` itself is tested in `@talon/agent-providers` (run through the repo root's own `pnpm test`), not here — it has no mobile-specific logic of its own, just a `fetch`-only, `node:stream`-free transport.

## Tool subset

Only tools that make sense inside the app's OS sandbox are registered (`src/agent/mobile-tools.ts`) — no `shell.exec`, matching PRD §5.1's mobile row ("no raw shell access... limited to in-process, OS-mediated operations"):

| Tool | Tier | Notes |
|---|---|---|
| `device.info` | `safeReadOnly` | Platform/OS version, via `react-native`'s `Platform` |
| `fs.read_file` | `safeReadOnly` | Scoped to the app's sandboxed document directory (`expo-file-system`'s `Paths`/`File` API) |
| `fs.list_dir` | `safeReadOnly` | Same sandbox, via `Directory` |
| `web.search` | `heuristicSandboxed` | Only registered when a Tavily key is configured (Settings screen, `src/settings/tavily-settings.ts`) — a plain `fetch()` POST to Tavily's REST `/search` endpoint, not their MCP server (no `node:child_process` on Hermes to spawn it, unlike `apps/talond`'s `websearch` entry). One tier above the others — it sends query text to a third party, unlike the fully-sandboxed tools above it. |

## Verification status

This environment has no iOS/Android simulator tooling and no `adb` — everything here has been verified via `expo start --web` only (a real browser session: API key entry, a live network call to Gemini, state-machine transitions, and the error-handling path). Biometric prompts, `expo-secure-store`'s real Keychain/Keystore backend, the `NSAllowsLocalNetworking`/`usesCleartextTraffic` config's actual effect, and a genuine native build haven't been run on a device — in particular, `MobileOllamaProvider` reaching a real LAN address from a physical phone is implemented and unit-tested against a mocked `fetch`, but not verified end-to-end on hardware. See `docs/architecture/phase-3-mobile.md` §6 for the full list of what's unverified.

## Not yet implemented (later phases)

- Real persistence (`agent-memory`/`agent-skills` equivalents) — needs `expo-sqlite`, gated on PRD §7.3's open "confirm FTS5 ships in `expo-sqlite`" risk.
- On-device inference (Apple Foundation Models / LiteRT-LM Gemma) — Phase 4 scope; this app talks to Gemini Cloud or a LAN-reachable Ollama today, never a fully offline on-device model.
- The full local → small-cloud → premium-cloud provider router (PRD §3.3) — today's choice is a one-time user pick at setup, not an automatic escalation ladder.
