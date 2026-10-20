#!/usr/bin/env node
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import { talon } from "@talon/grpc-contracts";
import { createTalonDaemonServer } from "./grpc-server.js";

const projectRoot = process.env["TALON_PROJECT_ROOT"] ?? process.cwd();
const model = process.env["TALON_MODEL"] ?? "qwen2.5:7b-instruct";
const socketPath = process.env["TALON_SOCKET"] ?? path.join(projectRoot, ".talon", "talond.sock");
const toolsConfigPath = process.env["TALON_TOOLS_CONFIG"];
const secretsPath = process.env["TALON_SECRETS_FILE"];

mkdirSync(path.dirname(socketPath), { recursive: true });
if (existsSync(socketPath)) {
  unlinkSync(socketPath);
}

async function main(): Promise<void> {
  const { server: daemonServer, close } = await createTalonDaemonServer({
    projectRoot,
    model,
    ...(toolsConfigPath !== undefined ? { toolsConfigPath } : {}),
    ...(secretsPath !== undefined ? { secretsPath } : {}),
  });

  const server = new grpc.Server();
  server.addService(talon.TalonDaemonService, daemonServer);

  const address = `unix://${socketPath}`;
  server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error) => {
    if (error) {
      console.error("talond failed to bind:", error);
      process.exitCode = 1;
      return;
    }
    console.log(`talond listening on ${address} (model=${model}, projectRoot=${projectRoot})`);
  });

  async function shutdown(): Promise<void> {
    await close();
    server.tryShutdown(() => {
      if (existsSync(socketPath)) unlinkSync(socketPath);
      process.exit(0);
    });
  }

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error("talond failed to start:", error);
  process.exitCode = 1;
});
