#!/usr/bin/env node
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import { talon } from "@talon/grpc-contracts";
import { createTalonDaemonServer } from "./grpc-server.js";

const projectRoot = process.env["TALON_PROJECT_ROOT"] ?? process.cwd();
const model = process.env["TALON_MODEL"] ?? "qwen2.5:7b-instruct";
const socketPath = process.env["TALON_SOCKET"] ?? path.join(projectRoot, ".talon", "talond.sock");

mkdirSync(path.dirname(socketPath), { recursive: true });
if (existsSync(socketPath)) {
  unlinkSync(socketPath);
}

const server = new grpc.Server();
server.addService(talon.TalonDaemonService, createTalonDaemonServer({ projectRoot, model }));

const address = `unix://${socketPath}`;
server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error) => {
  if (error) {
    console.error("talond failed to bind:", error);
    process.exitCode = 1;
    return;
  }
  console.log(`talond listening on ${address} (model=${model}, projectRoot=${projectRoot})`);
});

function shutdown(): void {
  server.tryShutdown(() => {
    if (existsSync(socketPath)) unlinkSync(socketPath);
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
