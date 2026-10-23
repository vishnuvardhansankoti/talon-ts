#!/usr/bin/env node
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import { talon } from "@talon/grpc-contracts";
import { config as loadDotenv } from "dotenv";
import { resolveDaemonConfig } from "./daemon-config.js";
import { createTalonDaemonServer } from "./grpc-server.js";

// Loaded from the project this talond instance serves — resolveDaemonConfig()
// reads TALON_PROJECT_ROOT, so this has to mirror its exact default (unset
// -> cwd) and run before that call. Never overwrites a var already
// exported in the real shell environment — that always wins over whatever
// is in the file (dotenv's default), and a var set by whichever of
// cli/desktop auto-spawned this process wins too, for the same reason.
loadDotenv({ path: path.join(process.env["TALON_PROJECT_ROOT"] ?? process.cwd(), ".env"), quiet: true });

const config = resolveDaemonConfig();

mkdirSync(path.dirname(config.socketPath), { recursive: true });
if (existsSync(config.socketPath)) {
  unlinkSync(config.socketPath);
}

async function main(): Promise<void> {
  const { server: daemonServer, close } = await createTalonDaemonServer(config);

  const server = new grpc.Server();
  server.addService(talon.TalonDaemonService, daemonServer);

  const address = `unix://${config.socketPath}`;
  server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error) => {
    if (error) {
      console.error("talond failed to bind:", error);
      process.exitCode = 1;
      return;
    }
    console.log(`talond listening on ${address} (model=${config.model}, projectRoot=${config.projectRoot})`);
  });

  async function shutdown(): Promise<void> {
    await close();
    server.tryShutdown(() => {
      if (existsSync(config.socketPath)) unlinkSync(config.socketPath);
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
