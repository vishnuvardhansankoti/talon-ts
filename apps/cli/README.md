# @talon/cli

The `talon` command — a thin gRPC client to `talond`. Holds no agent state itself: it's a transport (readline over stdin/stdout) plus `y`/`N` approval prompts. See [`docs/architecture/phase-1.md`](../../docs/architecture/phase-1.md) §4 for the full protocol and cold-start design.

## Running it

From the root of this repo (or any project you want Talon operating in):

```
pnpm talon
```

or, once built, directly:

```
node apps/cli/dist/bin/talon.js
```

If `talond` isn't already running for the current project, `talon` spawns it and polls until it's ready (15s budget) before starting your session — there's nothing to start by hand. A second `talon` invocation in the same directory finds the already-running daemon and reconnects instead of spawning another, and won't kill it on exit (only the invocation that actually spawned it does) — so one `talon` session running alongside e.g. `apps/desktop` on the same project won't yank the daemon out from under the other. The one that *did* spawn it kills it (`SIGTERM`, letting `talond` shut down cleanly) when that `talon` process exits, so a relaunch always gets a daemon that's seen your current env vars rather than reusing a stale one.

Type a message and press enter. Safe tools run without asking; anything that reaches `PRE_APPROVAL` prints the proposed call and tier, then waits for `y`/`N`.

To run `talon` as a system-wide command rather than through this workspace:

```
cd apps/cli && pnpm link --global
```

## Build

```
pnpm --filter @talon/cli run build
```

## Environment variables

All optional — unset means "let `talond` apply its own default." `talon` reads these to resolve where to find/spawn its daemon and passes them through as that daemon's own environment when it has to spawn one.

| Variable | Default | Purpose |
|---|---|---|
| `TALON_PROJECT_ROOT` | `process.cwd()` | Root directory the daemon operates within |
| `TALON_MODEL` | `qwen2.5:7b-instruct` | Ollama model name |
| `TALON_MODEL_KEEP_ALIVE` | `30m` | Ollama's `keep_alive`, how long the model stays loaded between requests |
| `TALON_SOCKET` | `<project>/.talon/talond.sock` | Unix domain socket path |
| `TALON_TOOLS_CONFIG` | unset | Path to a YAML tools config (see `packages/agent-tools/examples/`) |
| `TALON_SECRETS_FILE` | unset | Path to a secrets file `{fromSecret}` references resolve against |
