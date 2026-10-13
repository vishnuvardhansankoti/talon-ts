import { execa } from "execa";

export interface SandboxExecOptions {
  readonly cwd: string;
  readonly envAllowlist?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly cancellation?: AbortSignal;
}

export interface SandboxExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_ENV_ALLOWLIST: readonly string[] = ["PATH", "HOME", "LANG"];

/**
 * PRD §5.1: cwd pinned, env allowlisted (no credential leakage into the
 * subprocess env), wall-clock timeout, output caps enforced here rather
 * than trusted to the tool. Parity-level isolation — restricted subprocess,
 * not an OS-level sandbox/container (a deliberate Phase 1 scope decision).
 */
export class ToolSandbox {
  async exec(command: string, args: string[], options: SandboxExecOptions): Promise<SandboxExecResult> {
    const env: Record<string, string> = {};
    for (const key of options.envAllowlist ?? DEFAULT_ENV_ALLOWLIST) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }

    const result = await execa(command, args, {
      cwd: options.cwd,
      env,
      extendEnv: false,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      reject: false,
      maxBuffer: 16 * 1024 * 1024,
      ...(options.cancellation !== undefined ? { cancelSignal: options.cancellation } : {}),
    });

    const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const stdout = String(result.stdout ?? "");
    const stderr = String(result.stderr ?? "");
    const truncated = stdout.length > maxBytes || stderr.length > maxBytes;

    return {
      stdout: stdout.slice(0, maxBytes),
      stderr: stderr.slice(0, maxBytes),
      exitCode: result.exitCode ?? -1,
      truncated,
    };
  }
}
