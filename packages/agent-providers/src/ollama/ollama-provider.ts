import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import {
  ModelProvider,
  type CompletionChunk,
  type CompletionRequest,
  type Message,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderLocality,
  type ToolSchema,
} from "../contract/model-provider.js";

interface OllamaToolCall {
  readonly id?: string;
  readonly function: { readonly name: string; readonly arguments: Record<string, unknown> };
}

interface OllamaChatLine {
  readonly message?: { readonly content?: string; readonly tool_calls?: readonly OllamaToolCall[] };
  readonly done: boolean;
}

function toOllamaMessages(messages: readonly Message[]): object[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function toOllamaTools(tools: readonly ToolSchema[]): object[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.id, description: t.description, parameters: t.inputSchema },
  }));
}

/** Splits a byte stream into trimmed, non-empty NDJSON lines. */
async function* parseNdjsonLines(stream: AsyncIterable<Uint8Array>): AsyncIterable<string> {
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) yield line;
      newlineIndex = buffer.indexOf("\n");
    }
  }
  const rest = buffer.trim();
  if (rest.length > 0) yield rest;
}

async function* toCompletionChunks(lines: AsyncIterable<string>): AsyncIterable<CompletionChunk> {
  for await (const line of lines) {
    const parsed = JSON.parse(line) as OllamaChatLine;
    const content = parsed.message?.content ?? "";
    if (content.length > 0) {
      yield { kind: "text", text: content };
    }
    for (const toolCall of parsed.message?.tool_calls ?? []) {
      yield {
        kind: "toolCall",
        call: {
          id: toolCall.id ?? randomUUID(),
          toolId: toolCall.function.name,
          input: toolCall.function.arguments,
        },
      };
    }
    if (parsed.done) {
      yield { kind: "done" };
    }
  }
}

export class OllamaProvider extends ModelProvider {
  readonly providerId = "ollama";
  readonly locality: ProviderLocality = "localDaemon";

  constructor(
    private readonly model: string,
    private readonly baseUrl: URL = new URL("http://127.0.0.1:11434"),
  ) {
    super();
  }

  get capabilities(): ProviderCapabilities {
    return {
      maxContextTokens: 8192, // model-dependent; a full implementation queries /api/show
      supportsFunctionCalling: true,
      supportsStreaming: true,
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
        stream: true,
        messages: toOllamaMessages(request.messages),
        ...(request.tools.length > 0 ? { tools: toOllamaTools(request.tools) } : {}),
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`ollama /api/chat failed: ${res.status} ${res.statusText}`);
    }

    const nodeStream = Readable.fromWeb(res.body as NodeWebReadableStream<Uint8Array>);
    yield* toCompletionChunks(parseNdjsonLines(nodeStream));
  }
}
