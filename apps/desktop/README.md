# @talon/desktop

An Electron desktop shell — same gRPC client model as `@talon/cli`, with a chat UI instead of a terminal. The main process owns the `talond` connection and daemon auto-start; the renderer is UI-only, reaching `talond` solely through a `contextBridge`-exposed API (`window.talon`) — no Node integration, no direct IPC access. See [`docs/architecture/phase-3-desktop.md`](../../docs/architecture/phase-3-desktop.md) for the full design, including two real bugs (Electron's `process.execPath` vs. a usable Node binary, and `ELECTRON_RUN_AS_NODE`'s ABI mismatch with `better-sqlite3`) found by actually running it.

## Running it

```
pnpm --filter @talon/desktop run build
pnpm --filter @talon/desktop run start
```

`start` runs `electron .`. Like the CLI, there's nothing to start by hand — the main process spawns `talond` (if it isn't already running for the current project) and waits for it before connecting.

- `dangerousConfirmRequired` tool calls get a native, blocking `dialog.showMessageBox` confirmation.
- `heuristicSandboxed` calls get a lightweight inline banner in the chat view (Approve/Deny) instead — see PRD §5.1's tier matrix.

## Build

```
pnpm --filter @talon/desktop run build
```

Runs `tsc -b` for the main/preload processes, a separate `tsc -p tsconfig.renderer.json` for the DOM-lib renderer, then copies `index.html`/`styles.css` into `dist/renderer/` (`tsc` only emits `.ts` → `.js`).

## Tests

```
pnpm test   # from the repo root — runs as the "desktop" jest project alongside packages/*
```

Covers the two pure, non-Electron-importing pieces: `resolveDaemonConfig()`'s env-var resolution (`src/main/daemon-client.ts`) and `toAgentEventPayload()`'s `AgentEvent` → IPC-payload mapping (`src/main/event-mapping.ts` — split out of `main.ts` specifically so it's importable without pulling in `electron`, since `main.ts`'s module-level `main().catch(...)` calls `app.whenReady()` as a side effect of being imported at all). The rest of `main.ts` (window creation, native dialog, IPC wiring) is Electron-API glue verified by actually running the app, not unit tests.

## Environment variables

Same set `@talon/cli` reads, resolved the same way (`src/main/daemon-client.ts`'s `resolveDaemonConfig()`) — see [`apps/cli/README.md`](../cli/README.md#environment-variables) for the table. Set them in the shell that launches `electron .`.

## Known limitation

`ensureTalondRunning` spawns the bare `node` command, resolved via `PATH` — correct for this dev workflow (the same `node` `@talon/cli`'s shell already runs `talond` with), but a packaged, double-clicked Electron app has no guaranteed `PATH`-reachable Node at all. A real packaging pass should spawn `apps/talond`'s `pkg`-compiled standalone binary instead (see `apps/talond/package.json`'s `package` script).
