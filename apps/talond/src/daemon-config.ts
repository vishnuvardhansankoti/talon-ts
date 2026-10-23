import path from "node:path";
import type { TalondConfig } from "./grpc-server.js";

export interface ResolvedDaemonConfig extends TalondConfig {
  readonly socketPath: string;
}

export function resolveDaemonConfig(): ResolvedDaemonConfig {
  const projectRoot = process.env["TALON_PROJECT_ROOT"] ?? process.cwd();
  const model = process.env["TALON_MODEL"] ?? "qwen2.5:7b-instruct";
  const ollamaKeepAlive = process.env["TALON_MODEL_KEEP_ALIVE"] ?? "30m";
  const socketPath = process.env["TALON_SOCKET"] ?? path.join(projectRoot, ".talon", "talond.sock");
  const toolsConfigPath = process.env["TALON_TOOLS_CONFIG"];
  const secretsPath = process.env["TALON_SECRETS_FILE"];
  return {
    projectRoot,
    model,
    ollamaKeepAlive,
    socketPath,
    ...(toolsConfigPath !== undefined ? { toolsConfigPath } : {}),
    ...(secretsPath !== undefined ? { secretsPath } : {}),
  };
}
