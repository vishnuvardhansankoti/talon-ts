/**
 * Mirrors packages/agent-core/src/shared/ports.ts's shapes exactly (Message,
 * ToolSchema, CompletionRequest, CompletionChunk, ProposedToolCall) without
 * importing that package — same structural-typing approach agent-tools uses
 * for ToolRegistryPort. Only apps/talond imports both and wires them together.
 */

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
  readonly toolCallId?: string;
}

export type JsonSchema = Record<string, unknown>;

export interface ToolSchema {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
}

export interface ProposedToolCall {
  readonly id: string;
  readonly toolId: string;
  readonly input: Record<string, unknown>;
}

export type CompletionChunk =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "toolCall"; readonly call: ProposedToolCall }
  | { readonly kind: "done" };

export interface CompletionRequest {
  readonly messages: Message[];
  readonly tools: ToolSchema[];
}

export type ProviderLocality = "onDevice" | "localDaemon" | "cloud";
export type ProviderHealth = "ready" | "modelNotDownloaded" | "daemonUnreachable" | "authMissing" | "unsupported";

export const CloudTier = {
  None: "none",
  Small: "small",
  Premium: "premium",
} as const;
export type CloudTier = (typeof CloudTier)[keyof typeof CloudTier];

export interface ProviderCapabilities {
  readonly maxContextTokens: number;
  readonly supportsFunctionCalling: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsVision: boolean;
}

/** PRD §2.2. */
export abstract class ModelProvider {
  abstract readonly providerId: string;
  abstract readonly locality: ProviderLocality;
  abstract readonly capabilities: ProviderCapabilities;

  get cloudTier(): CloudTier {
    return CloudTier.None;
  }

  abstract checkHealth(): Promise<ProviderHealth>;
  abstract complete(request: CompletionRequest): AsyncIterable<CompletionChunk>;
}
