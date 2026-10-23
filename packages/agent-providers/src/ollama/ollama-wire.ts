import type { CompletionChunk, Message, ToolSchema } from "../contract/model-provider.js";

/**
 * Request/response mapping shared by every Ollama-backed provider in this
 * package — pure data transforms, deliberately free of any Node-only API
 * (`node:crypto`, `node:stream`), since one of the two callers
 * (MobileOllamaProvider) has to run on Hermes/React Native. The streaming
 * vs. non-streaming transport difference between those two callers lives
 * in each provider's own file, not here.
 */

export interface OllamaToolCall {
  readonly id?: string;
  readonly function: { readonly name: string; readonly arguments: Record<string, unknown> };
}

export interface OllamaChatMessage {
  readonly content?: string;
  readonly tool_calls?: readonly OllamaToolCall[];
}

export function toOllamaMessages(messages: readonly Message[]): object[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export function toOllamaTools(tools: readonly ToolSchema[]): object[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.id, description: t.description, parameters: t.inputSchema },
  }));
}

/**
 * Maps one Ollama chat message — one NDJSON line's `.message` for the
 * streaming transport, or the single response's `.message` for the
 * non-streaming one — into `CompletionChunk`s. Never emits `{ kind: "done" }`;
 * each caller knows its own transport's done-signal (a line's own `done`
 * flag vs. "the one response already is the end") and appends it itself.
 * `mintId` lets a caller avoid `node:crypto` entirely — pass
 * `() => globalThis.crypto.randomUUID()` on a runtime with no Node core
 * modules.
 */
export function toCompletionChunks(message: OllamaChatMessage | undefined, mintId: () => string): CompletionChunk[] {
  const chunks: CompletionChunk[] = [];
  const content = message?.content ?? "";
  if (content.length > 0) {
    chunks.push({ kind: "text", text: content });
  }
  for (const toolCall of message?.tool_calls ?? []) {
    chunks.push({
      kind: "toolCall",
      call: { id: toolCall.id ?? mintId(), toolId: toolCall.function.name, input: toolCall.function.arguments },
    });
  }
  return chunks;
}
