# Talon

A lightweight, extensible agent runtime: the same orchestration core (state machine, tool sandboxing, approval gates) runs headless on a daemon process and is driven by thin client shells — a CLI today, Electron/React Native later.

Full product spec and architecture: [`docs/PRD.md`](docs/PRD.md). This README covers what's actually implemented (Phase 1) and how to run it.

## Status: Phase 1 — Core Engine & CLI

`agent-core`'s state machine, `agent-tools`' safe/heuristic/dangerous tiering, and a CLI session against local Ollama, wired together over gRPC. No persistence, no memory, no skills catalog yet — those land in later phases per the PRD's roadmap (§7.2).

## Prerequisites

- Node.js 22+ (see `.nvmrc`)
- [pnpm](https://pnpm.io/) 11+
- `protoc` (Protocol Buffers compiler) on `PATH`
- [Ollama](https://ollama.com/) running locally with a tool-calling-capable model pulled, e.g.:
  ```
  ollama pull qwen2.5:7b-instruct
  ```

## Setup

```
pnpm install
pnpm run build
```

`pnpm install` will prompt once to approve a couple of dependencies' postinstall scripts (`protobufjs`, `esbuild`) — these just fetch platform binaries and compile small native helpers; both are safe to approve.

## Repo layout

```
proto/                 .proto schemas (talond's gRPC service)
packages/
  grpc-contracts/       generated TS/gRPC code from proto/ (via protoc + ts-proto)
  agent-core/           state machine, loop orchestrator, port interfaces
  agent-tools/          tool registry, execa-sandboxed executor, approval gate, builtin tools
  agent-providers/      ModelProvider contract + OllamaProvider
apps/
  talond/               the daemon — hosts agent-core, exposes it over gRPC
  cli/                  thin gRPC client: chat + y/N approval prompts
```

## Running it

```
talon
```

That's it — one command. `talon` is a workspace bin (`node_modules/.bin/talon`, available after `pnpm install`); run it from the root of whatever project you want Talon operating in. If `talond` isn't already running for that project, `talon` spawns it detached and waits until it's ready before starting your session — you never need to start the daemon by hand. The daemon outlives the CLI process, so a second `talon` invocation in the same directory reconnects to the one already running instead of starting another.

Type a message and press enter. Safe tools (`fs.read_file`, `fs.list_dir`) run without asking; anything routed to `shell.exec` outside the small built-in allowlist (`git status`, `npm test`, `ls`, `pwd`) will prompt for approval before running.

Each project gets its own daemon and socket, under `<project>/.talon/` (gitignored) — so running `talon` in two different directories never collides.

To run `talon` as a true system-wide command (not just from within this repo), link it globally once:

```
cd apps/cli && pnpm link --global
```

If you do need to run the daemon by hand (e.g. to watch its logs directly), `node apps/talond/dist/main.js` still works standalone.

### Environment variables

| Variable | Default | Used by |
|---|---|---|
| `TALON_PROJECT_ROOT` | `process.cwd()` | `talond` — root directory tools operate within; `cli` — passed through when it auto-starts talond |
| `TALON_MODEL` | `qwen2.5:7b-instruct` | `talond` — Ollama model name |
| `TALON_SOCKET` | `<project>/.talon/talond.sock` | `talond` and `cli` — Unix domain socket path they talk over |

## Development

```
pnpm run build   # tsc -b across all packages (via turbo, cached)
pnpm run lint     # eslint, including the agent-core dependency-boundary rules
pnpm run test     # jest, across agent-core / agent-tools / agent-providers
```

## Packaging the daemon

```
pnpm --filter @talon/talond run package
```

Bundles `talond` (esbuild) and packages it into a standalone binary (`@yao-pkg/pkg`) at `apps/talond/pkg-build/talond` — no Node install required on the target machine.
