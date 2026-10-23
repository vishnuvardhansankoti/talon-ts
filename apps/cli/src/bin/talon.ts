#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as readline from "node:readline";
import * as grpc from "@grpc/grpc-js";
import { talon } from "@talon/grpc-contracts";
import { config as loadDotenv } from "dotenv";
import { resolveCliConfig } from "../cli-config.js";

const require = createRequire(import.meta.url);

// Loaded from the *project* talon is operating on (same place tools.yaml's
// own convention puts <project>/.talon/, not apps/cli's own location in
// this monorepo) — resolveCliConfig() reads TALON_PROJECT_ROOT, so this has
// to mirror its exact default (unset -> cwd) and run before that call.
// Never overwrites a var already exported in the real shell environment —
// that always wins over whatever's in the file (dotenv's default).
loadDotenv({ path: path.join(process.env["TALON_PROJECT_ROOT"] ?? process.cwd(), ".env"), quiet: true });

const { projectRoot, model, toolsConfigPath, secretsPath, socketPath, address } = resolveCliConfig();

const client = new talon.TalonDaemonClient(address, grpc.credentials.createInsecure());
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

/**
 * A single readline interface can only sensibly handle one pending question
 * at a time. Rather than racing rl.question() calls from the main chat loop
 * against ones from approval prompts (a real concurrency bug caught while
 * writing this), every line from stdin routes through this one handler:
 * it goes to whichever is currently pending — an approval answer if one is
 * outstanding, otherwise a chat message.
 */
let pendingApproval: ((decision: "approved" | "denied") => void) | null = null;

function askApproval(): Promise<"approved" | "denied"> {
  return new Promise((resolve) => {
    pendingApproval = resolve;
  });
}

/**
 * readline starts consuming stdin the moment it's created, independent of
 * whether a 'line' listener is attached yet — a listener added later simply
 * never sees lines that arrived before it. A cold start (spawning talond,
 * polling for it to become ready) can take several seconds, so attaching
 * the listener only once the session is ready would silently drop anything
 * typed in that window (caught by testing the cold-start path for real).
 * The fix: attach the listener immediately and buffer lines until there's
 * an active call to send them on.
 */
let activeCall: grpc.ClientDuplexStream<talon.ClientMessage, talon.ServerMessage> | null = null;
const bufferedLines: string[] = [];

rl.on("line", (line) => {
  if (pendingApproval) {
    const resolve = pendingApproval;
    pendingApproval = null;
    resolve(line.trim().toLowerCase() === "y" ? "approved" : "denied");
    return;
  }
  if (activeCall) {
    activeCall.write({ channelInput: { text: line } });
  } else {
    bufferedLines.push(line);
  }
});
rl.on("close", () => activeCall?.end());

rl.setPrompt("> ");
rl.prompt();

function checkHealthOnce(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    client.checkHealth({}, new grpc.Metadata(), { deadline: Date.now() + timeoutMs }, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Set only when *this* invocation spawns talond — never when it attaches to
 * one that was already running. Killed on this process's own exit (below),
 * so a quick `talon` run doesn't leave a daemon behind holding onto
 * now-stale env vars (e.g. an edited tools.yaml/TAVILY_API_KEY from a
 * previous run); a talond this invocation merely reused — e.g. one
 * apps/desktop is also attached to — is left alone.
 */
let spawnedTalond: ChildProcess | undefined;

/**
 * `talon` is meant to be a single command — no separately running talond
 * expected. If the daemon for this project isn't already up, spawn it and
 * poll until it's reachable.
 */
async function ensureTalondRunning(): Promise<void> {
  if (await checkHealthOnce(500)) return;

  console.error("talond not running — starting it...");
  mkdirSync(path.dirname(socketPath), { recursive: true });

  const talondPackageJson = require.resolve("@talon/talond/package.json") as string;
  const talondMain = path.join(path.dirname(talondPackageJson), "dist", "main.js");

  const child = spawn(
    process.execPath,
    [talondMain],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        TALON_PROJECT_ROOT: projectRoot,
        TALON_SOCKET: socketPath,
        ...(model !== undefined ? { TALON_MODEL: model } : {}),
        ...(toolsConfigPath !== undefined ? { TALON_TOOLS_CONFIG: toolsConfigPath } : {}),
        ...(secretsPath !== undefined ? { TALON_SECRETS_FILE: secretsPath } : {}),
      },
    },
  );
  child.unref();
  spawnedTalond = child;

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await checkHealthOnce(500)) {
      console.error("talond is ready.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`talond did not become ready at ${address} within 15s`);
}

/** SIGTERM (not -9) so talond's own shutdown() handler gets to run — close()
 * on agent-memory's SQLite handle and any mcp stdio children, then unlink
 * the socket — rather than leaving those half-torn-down. */
function killSpawnedTalond(): void {
  if (spawnedTalond?.pid !== undefined && spawnedTalond.exitCode === null) {
    spawnedTalond.kill("SIGTERM");
  }
}

process.on("exit", killSpawnedTalond);
process.on("SIGINT", () => {
  killSpawnedTalond();
  process.exit(130);
});
process.on("SIGTERM", () => {
  killSpawnedTalond();
  process.exit(143);
});

async function main(): Promise<void> {
  await ensureTalondRunning();

  const health = await new Promise<talon.HealthResponse>((resolve, reject) => {
    client.checkHealth({}, (error, response) => (error ? reject(error) : resolve(response)));
  });
  if (health.status !== "ready") {
    console.error(`talond reports provider status "${health.status}" — continuing, but completions may fail.`);
  }

  const call = client.streamSession();
  activeCall = call;
  for (const line of bufferedLines.splice(0)) {
    call.write({ channelInput: { text: line } });
  }

  call.on("data", (msg: talon.ServerMessage) => {
    if (msg.channelOutput) {
      process.stdout.write(msg.channelOutput.text);
      if (msg.channelOutput.isFinal) {
        process.stdout.write("\n");
        rl.setPrompt("> ");
        rl.prompt();
      }
    } else if (msg.agentEvent?.stateTransitioned) {
      const { from, to } = msg.agentEvent.stateTransitioned;
      process.stderr.write(`\x1b[2m[${from} -> ${to}]\x1b[0m\n`);
    } else if (msg.agentEvent?.verificationResult) {
      const { passed, reason } = msg.agentEvent.verificationResult;
      process.stderr.write(`\x1b[2m[verify ${passed ? "passed" : "failed"}${reason ? `: ${reason}` : ""}]\x1b[0m\n`);
    } else if (msg.approvalRequest) {
      void handleApprovalRequest(call, msg.approvalRequest);
    }
  });

  call.on("error", (error: Error) => {
    console.error("talond stream error:", error.message);
  });
  call.on("end", () => {
    rl.close();
  });
}

async function handleApprovalRequest(
  call: grpc.ClientDuplexStream<talon.ClientMessage, talon.ServerMessage>,
  request: talon.ApprovalRequest,
): Promise<void> {
  rl.setPrompt("");
  console.error(`\n! ${request.toolId} (${request.safetyTier}): ${request.inputJson}`);
  console.error("  approve? [y/N] ");
  const decision = await askApproval();
  call.write({ approvalDecision: { callId: request.callId, decision } });
  rl.setPrompt("> ");
  rl.prompt();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
