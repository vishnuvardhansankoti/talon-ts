import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import { talon } from "@talon/grpc-contracts";
import type { ConnectionStatus } from "../shared/ipc-channels.js";

const require = createRequire(import.meta.url);

export interface DaemonConfig {
  readonly projectRoot: string;
  readonly socketPath: string;
  readonly model?: string;
  readonly toolsConfigPath?: string;
  readonly secretsPath?: string;
}

export function resolveDaemonConfig(): DaemonConfig {
  const projectRoot = process.env["TALON_PROJECT_ROOT"] ?? process.cwd();
  const model = process.env["TALON_MODEL"];
  const toolsConfigPath = process.env["TALON_TOOLS_CONFIG"];
  const secretsPath = process.env["TALON_SECRETS_FILE"];
  const socketPath = process.env["TALON_SOCKET"] ?? path.join(projectRoot, ".talon", "talond.sock");
  return {
    projectRoot,
    socketPath,
    ...(model !== undefined ? { model } : {}),
    ...(toolsConfigPath !== undefined ? { toolsConfigPath } : {}),
    ...(secretsPath !== undefined ? { secretsPath } : {}),
  };
}

function checkHealthOnce(client: talon.TalonDaemonClient, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    client.checkHealth({}, new grpc.Metadata(), { deadline: Date.now() + timeoutMs }, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Same cold-start contract as apps/cli/src/bin/talon.ts's ensureTalondRunning
 * — Electron's main process is just another thin gRPC client (PRD §1.3), so
 * it owns the same "auto-start talond if it isn't up yet" responsibility.
 * Duplicated rather than extracted into a shared package: this is the
 * second (not third) place this logic lives, and the two callers differ in
 * how they report progress (stderr lines vs. an IPC status event) — not
 * worth a cross-app package for two call sites yet (phase-1.md §8 pattern).
 *
 * Returns the spawned child only when this call actually started one —
 * `undefined` means an already-running talond (e.g. one apps/cli is also
 * attached to) was reused and should be left alone. The caller kills it on
 * app quit (see main.ts) so a relaunch doesn't inherit a daemon holding
 * onto now-stale env vars from a previous run.
 */
export async function ensureTalondRunning(
  config: DaemonConfig,
  client: talon.TalonDaemonClient,
): Promise<ChildProcess | undefined> {
  if (await checkHealthOnce(client, 500)) return undefined;

  mkdirSync(path.dirname(config.socketPath), { recursive: true });

  const talondPackageJson = require.resolve("@talon/talond/package.json") as string;
  const talondMain = path.join(path.dirname(talondPackageJson), "dist", "main.js");

  const child = spawn("node", [talondMain], {
    // Unlike apps/cli (a plain Node process, where process.execPath *is*
    // node), this file runs inside Electron's main process —
    // process.execPath there points at the Electron binary, not a system
    // node. Two ways of getting a Node child from there both looked
    // plausible and both turned out wrong on inspection:
    //   1. spawn(process.execPath, ...) launches a second Electron
    //      instance that treats talondMain as an app path — never reaches
    //      main.js's own code at all.
    //   2. spawn(process.execPath, ..., { env: { ELECTRON_RUN_AS_NODE: "1" } })
    //      does run main.js, but under Electron's *own bundled* Node ABI
    //      (NODE_MODULE_VERSION 127 as of Electron 44), not the system
    //      Node talond's native deps were actually compiled against
    //      (149) — talond crashes the instant MemoryStore.open() dlopen's
    //      better-sqlite3's .node binary. Caught by actually running it,
    //      not something either approach's docs would tell you.
    // Spawning the bare command "node" and letting the OS resolve it via
    // PATH is what actually gets a Node binary ABI-matched to this
    // workspace's own native deps — the same one apps/cli's shell already
    // runs on. This assumes a real Node is on PATH, true for this dev
    // workflow; a packaged, double-clicked Electron app would need either
    // a bundled Node or to spawn apps/talond's own pkg-compiled standalone
    // binary (phase-1.md's existing "package" script) instead — a
    // packaging-time concern, not a Phase 3 dev-loop blocker.
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      TALON_PROJECT_ROOT: config.projectRoot,
      TALON_SOCKET: config.socketPath,
      ...(config.model !== undefined ? { TALON_MODEL: config.model } : {}),
      ...(config.toolsConfigPath !== undefined ? { TALON_TOOLS_CONFIG: config.toolsConfigPath } : {}),
      ...(config.secretsPath !== undefined ? { TALON_SECRETS_FILE: config.secretsPath } : {}),
    },
  });
  child.unref();

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await checkHealthOnce(client, 500)) return child;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`talond did not become ready at unix://${config.socketPath} within 15s`);
}

export interface DaemonSession {
  readonly client: talon.TalonDaemonClient;
  readonly call: grpc.ClientDuplexStream<talon.ClientMessage, talon.ServerMessage>;
  /** Only set when this session's connectToTalond() call spawned talond
   * itself — see ensureTalondRunning's doc comment. */
  readonly spawnedTalond?: ChildProcess;
}

export async function connectToTalond(onStatus: (status: ConnectionStatus) => void): Promise<DaemonSession> {
  const config = resolveDaemonConfig();
  const address = `unix://${config.socketPath}`;
  const client = new talon.TalonDaemonClient(address, grpc.credentials.createInsecure());

  onStatus({ phase: "starting-daemon" });
  const spawnedTalond = await ensureTalondRunning(config, client);

  onStatus({ phase: "connecting" });
  const health = await new Promise<talon.HealthResponse>((resolve, reject) => {
    client.checkHealth({}, (error, response) => (error ? reject(error) : resolve(response)));
  });

  const call = client.streamSession();
  onStatus({ phase: "ready", providerStatus: health.status });
  return { client, call, ...(spawnedTalond !== undefined ? { spawnedTalond } : {}) };
}
