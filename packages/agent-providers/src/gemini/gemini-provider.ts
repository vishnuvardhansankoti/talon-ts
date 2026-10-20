import {
  CloudTier,
  ModelProvider,
  type CompletionChunk,
  type CompletionRequest,
  type Message,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderLocality,
  type ToolSchema,
} from "../contract/model-provider.js";

/** PRD §5.3 — Talon's own approval-gate/PII-scrub layers are the actual
 * safety boundary; stacking aggressive content-filter false positives on
 * top of a tool-use agent mostly produces broken function calls. */
export const geminiSafetySettings = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
] as const;

interface GeminiPart {
  readonly text?: string;
  readonly functionCall?: { readonly name: string; readonly args: Record<string, unknown> };
  readonly functionResponse?: { readonly name: string; readonly response: Record<string, unknown> };
}

interface GeminiContent {
  readonly role: "user" | "model";
  readonly parts: GeminiPart[];
}

interface GeminiGenerateContentResponse {
  readonly candidates?: ReadonlyArray<{
    readonly content?: { readonly parts?: readonly GeminiPart[] };
  }>;
}

function toFunctionDecls(tools: readonly ToolSchema[]): object[] {
  return tools.map((t) => ({ name: t.id, description: t.description, parameters: t.inputSchema }));
}

/**
 * Builds Gemini's `contents`/`systemInstruction` split from agent-core's
 * flat Message[] (system-role turns have no equivalent slot in `contents`
 * — Gemini only accepts "user"/"model" there, §6.4's own illustrative
 * `toGeminiContents` doesn't show this, but the real API rejects any other
 * role value).
 *
 * `callIdToName` resolves a tool-role Message's `toolCallId` back to the
 * function *name* Gemini's functionResponse part requires — agent-core's
 * Message only carries the call id (the id this same provider minted when
 * it parsed the original functionCall out of a prior response; see
 * `toCompletionChunks` below), not the tool's name, so without this lookup
 * there'd be nothing else to put there. Falls back to the raw call id if
 * the map has no entry (e.g. a provider instance recreated mid-session) —
 * better than crashing, but Gemini may reject it; a known limitation
 * rather than a silent data-loss path, since it only matters for a
 * scenario (provider recreated between tool-call and tool-result) this
 * package never actually does today.
 */
function toGeminiRequestContents(
  messages: readonly Message[],
  callIdToName: ReadonlyMap<string, string>,
): { readonly contents: GeminiContent[]; readonly systemInstruction?: { readonly parts: GeminiPart[] } } {
  const systemParts: GeminiPart[] = [];
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push({ text: message.content });
    } else if (message.role === "tool") {
      const name = (message.toolCallId && callIdToName.get(message.toolCallId)) ?? message.toolCallId ?? "unknown";
      contents.push({ role: "user", parts: [{ functionResponse: { name, response: { result: message.content } } }] });
    } else {
      contents.push({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] });
    }
  }

  return systemParts.length > 0 ? { contents, systemInstruction: { parts: systemParts } } : { contents };
}

function toCompletionChunks(
  response: GeminiGenerateContentResponse,
  callIdToName: Map<string, string>,
): CompletionChunk[] {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const chunks: CompletionChunk[] = [];

  for (const part of parts) {
    if (part.text) {
      chunks.push({ kind: "text", text: part.text });
    } else if (part.functionCall) {
      const id = globalThis.crypto.randomUUID();
      callIdToName.set(id, part.functionCall.name);
      chunks.push({ kind: "toolCall", call: { id, toolId: part.functionCall.name, input: part.functionCall.args } });
    }
  }

  chunks.push({ kind: "done" });
  return chunks;
}

/**
 * PRD §6.4. **Diverges from the PRD's own snippet in one deliberate way:**
 * this calls Gemini's non-streaming `generateContent` endpoint, not
 * `streamGenerateContent?alt=sse`. The PRD's SSE sketch assumes a runtime
 * that can incrementally read a fetch Response's body stream — true in
 * Node (every other provider here only ever runs inside `talond`), but
 * this is the one provider PRD §7.2 Phase 3 requires to also run
 * in-process on mobile (Hermes/React Native), where streaming-body fetch
 * support is version-dependent and untestable from this environment (no
 * device/simulator available — see phase-3-mobile.md). A single
 * non-streaming call keeps this package's one Gemini implementation
 * correct on both runtimes without an environment branch inside it;
 * `complete()` still satisfies the same `AsyncIterable<CompletionChunk>`
 * contract every other provider does, it just yields its chunks after one
 * round-trip instead of as they arrive. Revisit once a concrete RN
 * streaming-fetch capability is confirmed on a real device.
 */
export class GeminiProvider extends ModelProvider {
  readonly providerId = "gemini";
  readonly locality: ProviderLocality = "cloud";
  private readonly callIdToName = new Map<string, string>();

  private readonly _cloudTier: CloudTier;

  constructor(
    cloudTier: CloudTier,
    private readonly modelId: string,
    private readonly apiKey: string,
    private readonly baseUrl: URL = new URL("https://generativelanguage.googleapis.com/"),
  ) {
    super();
    this._cloudTier = cloudTier;
  }

  override get cloudTier(): CloudTier {
    return this._cloudTier;
  }

  get capabilities(): ProviderCapabilities {
    return {
      maxContextTokens: 1_000_000,
      supportsFunctionCalling: true,
      supportsStreaming: true,
      supportsVision: true,
    };
  }

  async checkHealth(): Promise<ProviderHealth> {
    return this.apiKey ? "ready" : "authMissing";
  }

  async *complete(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const { contents, systemInstruction } = toGeminiRequestContents(request.messages, this.callIdToName);
    const url = new URL(`v1beta/models/${this.modelId}:generateContent`, this.baseUrl);
    url.searchParams.set("key", this.apiKey);

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents,
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(request.tools.length > 0 ? { tools: [{ functionDeclarations: toFunctionDecls(request.tools) }] } : {}),
        safetySettings: geminiSafetySettings,
      }),
    });

    if (!res.ok) {
      throw new Error(`gemini generateContent failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as GeminiGenerateContentResponse;
    yield* toCompletionChunks(body, this.callIdToName);
  }
}
