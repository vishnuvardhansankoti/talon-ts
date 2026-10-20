#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as readline from "node:readline";
import * as grpc from "@grpc/grpc-js";
import { talon } from "@talon/grpc-contracts";

const require = createRequire(import.meta.url);

const projectRoot = process.env["TALON_PROJECT_ROOT"] ?? process.cwd();
const model = process.env["TALON_MODEL"]; // undefined means "let talond apply its own default"
const toolsConfigPath = process.env["TALON_TOOLS_CONFIG"]; // undefined means "no config-declared tools"
const secretsPath = process.env["TALON_SECRETS_FILE"]; // undefined means "no secrets file configured"
const socketPath = process.env["TALON_SOCKET"] ?? path.join(projectRoot, ".talon", "talond.sock");
const address = `unix://${socketPath}`;

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
 * `talon` is meant to be a single command — no separately running talond
 * expected. If the daemon for this project isn't already up, spawn it
 * detached (so it outlives this CLI process, per PRD §1.3/§1.4) and poll
 * until it's reachable.
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

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await checkHealthOnce(500)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`talond did not become ready at ${address} within 15s`);
}

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
