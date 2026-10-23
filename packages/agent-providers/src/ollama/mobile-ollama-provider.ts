import {
  ModelProvider,
  type CompletionChunk,
  type CompletionRequest,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderLocality,
} from "../contract/model-provider.js";
import { toCompletionChunks, toOllamaMessages, toOllamaTools, type OllamaChatMessage } from "./ollama-wire.js";

interface OllamaChatResponse {
  readonly message?: OllamaChatMessage;
}

/** Ollama's own `keep_alive` request field — how long the model stays
 * resident after this call before Ollama evicts it (default 5m when
 * omitted). No Settings-screen control on mobile — one fixed, sensible
 * value, matching OllamaProvider's own default; see that file's
 * constructor comment for why this (not an actual KV-cache, which this
 * package has no handle to at all) is the real lever available here. */
const KEEP_ALIVE = "30m";

/**
 * RN/Hermes-safe Ollama client for apps/mobile's "local" tier (PRD §7.2) —
 * "local" here means reachable over the phone's own LAN (e.g. a laptop
 * running Ollama), not literally on-device; Ollama has no iOS/Android
 * port. Diverges from `OllamaProvider` the exact way `GeminiProvider`
 * diverges from the PRD's own SSE sketch (see that file's comment for the
 * fuller rationale): a single non-streaming `/api/chat` call
 * (`stream: false`) instead of parsing NDJSON off a byte stream, since
 * `OllamaProvider`'s transport (`node:stream`, `node:crypto`) doesn't
 * exist on Hermes. `complete()` still satisfies the same
 * `AsyncIterable<CompletionChunk>` contract every other provider does —
 * it just yields every chunk after one round-trip instead of as tokens
 * arrive.
 */
export class MobileOllamaProvider extends ModelProvider {
  readonly providerId = "ollama";
  readonly locality: ProviderLocality = "localDaemon";

  constructor(
    private readonly model: string,
    private readonly baseUrl: URL,
  ) {
    super();
  }

  get capabilities(): ProviderCapabilities {
    return {
      maxContextTokens: 8192, // model-dependent; a full implementation queries /api/show
      supportsFunctionCalling: true,
      supportsStreaming: false,
      supportsVision: false,
    };
  }

  async checkHealth(): Promise<ProviderHealth> {
    try {
      const res = await fetch(new URL("/api/tags", this.baseUrl), { signal: AbortSignal.timeout(2000) });
      return res.ok ? "ready" : "daemonUnreachable";
    } catch {
      return "daemonUnreachable";
    }
  }

  async *complete(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const res = await fetch(new URL("/api/chat", this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        keep_alive: KEEP_ALIVE,
        messages: toOllamaMessages(request.messages),
        ...(request.tools.length > 0 ? { tools: toOllamaTools(request.tools) } : {}),
      }),
    });

    if (!res.ok) {
      throw new Error(`ollama /api/chat failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as OllamaChatResponse;
    yield* toCompletionChunks(body.message, () => globalThis.crypto.randomUUID());
    yield { kind: "done" };
  }
}
