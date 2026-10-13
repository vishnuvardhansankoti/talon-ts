/**
 * agent-core depends on nothing concrete outside itself (PRD §2.3). These
 * port interfaces are structurally compatible with the real ModelProvider /
 * ToolRegistry / ApprovalGate classes defined in agent-providers / agent-tools,
 * but agent-core never imports those packages — only apps/talond does, and it
 * wires concrete instances in wherever a port is expected.
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

export interface ModelProviderPort {
  complete(request: CompletionRequest): AsyncIterable<CompletionChunk>;
}

export type ToolSafetyTierPort = "safeReadOnly" | "heuristicSandboxed" | "dangerousConfirmRequired";

export type ToolExecutionResultPort =
  | { readonly success: true; readonly output: unknown }
  | { readonly success: false; readonly errorCode: string; readonly errorMessage: string };

export interface ToolExecutionPortContext {
  readonly sessionId: string;
  readonly cancellation: AbortSignal;
}

export interface ToolRegistryPort {
  listSchemas(): ToolSchema[];
  resolveTier(toolId: string, input: Record<string, unknown>): ToolSafetyTierPort;
  execute(
    toolId: string,
    input: Record<string, unknown>,
    ctx: ToolExecutionPortContext,
  ): Promise<ToolExecutionResultPort>;
}

export type ApprovalDecisionPort = "approved" | "denied" | "timedOut";

export interface ApprovalGatePort {
  request(call: ProposedToolCall, tier: ToolSafetyTierPort): Promise<ApprovalDecisionPort>;
}
