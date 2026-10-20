import net from "node:net";
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

export interface SandboxFetchRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface SandboxFetchOptions {
  readonly allowedHosts: readonly string[];
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly cancellation?: AbortSignal;
}

export interface SandboxFetchResult {
  readonly status: number;
  readonly body: string;
  readonly truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_ENV_ALLOWLIST: readonly string[] = ["PATH", "HOME", "LANG"];

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;

/** A literal IP (v4 or v6) or "localhost" is always blocked, even if an
 * entry's `allowedHosts` lists it — this is what actually closes off SSRF
 * to loopback/link-local/cloud-metadata addresses (design doc §4), since
 * every one of those targets is reached via a literal address, never a
 * hostname a legitimate external API would use. */
function isBlockedHostname(hostname: string): boolean {
  return hostname.toLowerCase() === "localhost" || net.isIP(hostname) !== 0;
}

function assertHostAllowed(hostname: string, allowedHosts: readonly string[]): void {
  if (isBlockedHostname(hostname)) {
    throw new Error(`host "${hostname}" is blocked (literal IP addresses and "localhost" are never allowed)`);
  }
  const normalized = hostname.toLowerCase();
  if (!allowedHosts.some((allowed) => allowed.toLowerCase() === normalized)) {
    throw new Error(`host "${hostname}" is not in the configured allowedHosts list`);
  }
}

async function readBodyCapped(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (response.body === null) return { text: "", truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.length;
  }

  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  return { text, truncated };
}

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

  /**
   * Design doc §4: the http-shaped equivalent of `exec()`'s discipline —
   * timeout, response-size cap — plus a host allowlist checked on the
   * initial URL and every redirect hop (not just the final destination),
   * since a hop into an unlisted host is exactly how an allowlist gets
   * bypassed otherwise.
   */
  async fetch(request: SandboxFetchRequest, options: SandboxFetchOptions): Promise<SandboxFetchResult> {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const signal = options.cancellation !== undefined ? AbortSignal.any([timeoutSignal, options.cancellation]) : timeoutSignal;

    let currentUrl = new URL(request.url);
    let hopCount = 0;

    while (true) {
      assertHostAllowed(currentUrl.hostname, options.allowedHosts);

      const response = await fetch(currentUrl, {
        method: request.method,
        ...(request.headers !== undefined ? { headers: request.headers } : {}),
        ...(request.body !== undefined ? { body: request.body } : {}),
        redirect: "manual",
        signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null) {
          throw new Error(`redirect response (${response.status}) is missing a Location header`);
        }
        hopCount += 1;
        if (hopCount > MAX_REDIRECTS) {
          throw new Error(`exceeded ${MAX_REDIRECTS} redirects`);
        }
        currentUrl = new URL(location, currentUrl);
        continue;
      }

      const { text, truncated } = await readBodyCapped(response, options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
      return { status: response.status, body: text, truncated };
    }
  }
}
