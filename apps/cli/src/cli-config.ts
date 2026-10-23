import path from "node:path";

export interface CliConfig {
  readonly projectRoot: string;
  readonly socketPath: string;
  readonly address: string;
  readonly model?: string;
  readonly toolsConfigPath?: string;
  readonly secretsPath?: string;
}

export function resolveCliConfig(): CliConfig {
  const projectRoot = process.env["TALON_PROJECT_ROOT"] ?? process.cwd();
  const model = process.env["TALON_MODEL"]; // undefined means "let talond apply its own default"
  const toolsConfigPath = process.env["TALON_TOOLS_CONFIG"]; // undefined means "no config-declared tools"
  const secretsPath = process.env["TALON_SECRETS_FILE"]; // undefined means "no secrets file configured"
  const socketPath = process.env["TALON_SOCKET"] ?? path.join(projectRoot, ".talon", "talond.sock");
  return {
    projectRoot,
    socketPath,
    address: `unix://${socketPath}`,
    ...(model !== undefined ? { model } : {}),
    ...(toolsConfigPath !== undefined ? { toolsConfigPath } : {}),
    ...(secretsPath !== undefined ? { secretsPath } : {}),
  };
}
