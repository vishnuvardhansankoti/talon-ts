# Talon

A lightweight, extensible agent runtime: the same orchestration core (state machine, tool sandboxing, approval gates) runs headless on a daemon process and is driven by thin client shells — a CLI today, Electron/React Native later.

Full product spec and architecture: [`docs/PRD.md`](docs/PRD.md). This README covers what's actually implemented (Phases 1–2) and how to run it.

## Status: Phase 2 — Memory & Skills

`agent-core`'s state machine, `agent-tools`' safe/heuristic/dangerous tiering, `agent-memory`'s three-tier persistence (`USER.md`/`MEMORY.md`/SQLite FTS5), and `agent-skills`' catalog + fire-and-forget synthesis, all wired together over gRPC and driven by a CLI session against local Ollama. See [`docs/architecture/phase-1.md`](docs/architecture/phase-1.md) and [`docs/architecture/phase-2.md`](docs/architecture/phase-2.md) for what each phase actually built, including a few places real implementation diverged from or filled gaps in the PRD.

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
  agent-memory/         USER.md / MEMORY.md / SQLite FTS5 — the three memory tiers (§4)
  agent-skills/         SKILL.md parser, catalog, progressive disclosure, synthesizer (§2.2/§4.4)
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

Each project gets its own daemon, socket, and memory — `<project>/.talon/` (gitignored) holds the socket plus `USER.md`/`MEMORY.md`/`memory.db` (your profile, episodic facts, and searchable session history) and any project-local skills, so running `talon` in two different directories never collides or shares context. A small bundled skill (`skill.run_tests`) ships out of the box; ask Talon to run the test suite to see it activate.

To run `talon` as a true system-wide command (not just from within this repo), link it globally once:

```
cd apps/cli && pnpm link --global
```

If you do need to run the daemon by hand (e.g. to watch its logs directly), `node apps/talond/dist/main.js` still works standalone.

### Environment variables

| Variable | Default | Used by |
|---|---|---|
| `TALON_PROJECT_ROOT` | `process.cwd()` | `talond` — root directory tools and memory operate within; `cli` — passed through when it auto-starts talond |
| `TALON_MODEL` | `qwen2.5:7b-instruct` | `talond` — Ollama model name |
| `TALON_SOCKET` | `<project>/.talon/talond.sock` | `talond` and `cli` — Unix domain socket path they talk over |
| `TALON_TOOLS_CONFIG` | unset (no config-declared tools) | `talond` — path to a YAML file or directory declaring extra `http`/`exec`/`mcp` tools (see `packages/agent-tools/examples/`), hot-reloaded on change |
| `TALON_SECRETS_FILE` | unset | `talond` — path to a secrets file `{fromSecret}` references in `TALON_TOOLS_CONFIG` resolve against |

## Development

```
pnpm run build   # tsc -b across all packages (via turbo, cached)
pnpm run lint     # eslint, including the agent-core dependency-boundary rules
pnpm run test     # jest, across agent-core / agent-tools / agent-providers / agent-memory / agent-skills
```

## Packaging the daemon

```
pnpm --filter @talon/talond run package
```

Bundles `talond` (esbuild) and packages it into a standalone binary (`@yao-pkg/pkg`) at `apps/talond/pkg-build/talond` — no Node install required on the target machine.
