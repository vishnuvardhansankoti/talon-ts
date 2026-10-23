import type * as grpc from "@grpc/grpc-js";
import { AgentLoop, type AgentEvent } from "@talon/agent-core";
import { MemoryStore } from "@talon/agent-memory";
import { OllamaProvider } from "@talon/agent-providers";
import { SkillCatalog } from "@talon/agent-skills";
import { ApprovalGate, ToolRegistry, builtinTools, watchToolsFromYaml, type ToolDefinition } from "@talon/agent-tools";
import { talon } from "@talon/grpc-contracts";
import { GrpcApprovalPrompter } from "./approval/grpc-approval-bridge.js";
import { GrpcChannel } from "./channel/grpc-channel.js";

export interface TalondConfig {
  readonly model: string;
  readonly projectRoot: string;
  readonly ollamaBaseUrl?: URL;
  /** Ollama's `keep_alive` — see OllamaProvider's constructor comment for
   * why this, not an actual KV-cache, is the real lever this daemon has
   * over model-reload latency between turns. */
  readonly ollamaKeepAlive?: string;
  readonly toolsConfigPath?: string;
  readonly secretsPath?: string;
}

export interface TalonDaemonServerHandle {
  readonly server: talon.TalonDaemonServer;
  /** Closes every connection opened by a `kind: mcp` config entry and the
   * `agent-memory` SQLite handle. Call once on shutdown. */
  close(): Promise<void>;
}

export function toServerMessage(event: AgentEvent): talon.ServerMessage {
  switch (event.kind) {
    case "StateTransitioned":
      return talon.ServerMessage.fromPartial({
        agentEvent: { stateTransitioned: { from: event.from.kind, to: event.to.kind } },
      });
    case "ToolCallProposed":
      return talon.ServerMessage.fromPartial({
        agentEvent: {
          toolCallProposed: {
            callId: event.call.id,
            toolId: event.call.toolId,
            inputJson: JSON.stringify(event.call.input),
          },
        },
      });
    case "ToolCallDelta":
      return talon.ServerMessage.fromPartial({ agentEvent: { toolCallDelta: { partialJson: event.partialJson } } });
    case "VerificationResult":
      return talon.ServerMessage.fromPartial({
        agentEvent: { verificationResult: { passed: event.passed, reason: event.reason ?? "" } },
      });
    case "SkillSynthesized":
      return talon.ServerMessage.fromPartial({
        agentEvent: {
          skillSynthesized: { accepted: event.accepted, skillId: event.skillId ?? "", reason: event.reason },
        },
      });
  }
}

export async function createTalonDaemonServer(config: TalondConfig): Promise<TalonDaemonServerHandle> {
  const builtins = builtinTools(config.projectRoot);
  const toolRegistry = new ToolRegistry(builtins);

  const applyConfigReload = (configTools: readonly ToolDefinition[]): void => {
    try {
      toolRegistry.reset([...builtins, ...configTools]);
      console.log(`talond: tools.yaml reloaded (${configTools.length} config-declared tool(s))`);
    } catch (error) {
      console.error("talond: rejected tools.yaml reload (keeping previous tools):", error);
    }
  };

  let configHandle: Awaited<ReturnType<typeof watchToolsFromYaml>> | undefined;
  if (config.toolsConfigPath) {
    configHandle = await watchToolsFromYaml(config.toolsConfigPath, config.projectRoot, {
      ...(config.secretsPath !== undefined ? { secretsPath: config.secretsPath } : {}),
      onReload: applyConfigReload,
      onError: (error) => console.error("talond: tools.yaml reload failed (keeping previous tools):", error),
    });
    applyConfigReload(configHandle.tools);
  }

  const modelProvider = new OllamaProvider(config.model, config.ollamaBaseUrl, config.ollamaKeepAlive);
  const memoryStore = await MemoryStore.open(config.projectRoot, config.model);
  const skillCatalog = await SkillCatalog.open(config.projectRoot);
  const close = async (): Promise<void> => {
    await configHandle?.close();
    await memoryStore.close();
  };

  const server: talon.TalonDaemonServer = {
    checkHealth: (_call, callback) => {
      modelProvider
        .checkHealth()
        .then((status) => callback(null, talon.HealthResponse.fromPartial({ status })))
        .catch((error: unknown) => callback(error as grpc.ServiceError, talon.HealthResponse.fromPartial({})));
    },

    streamSession: (call) => {
      const channel = new GrpcChannel(call);
      const prompter = new GrpcApprovalPrompter(call);
      const approvalGate = new ApprovalGate(prompter);

      call.on("data", (msg: talon.ClientMessage) => {
        if (msg.channelInput) {
          channel.input.push({ text: msg.channelInput.text });
        } else if (msg.approvalDecision) {
          prompter.resolveDecision(
            msg.approvalDecision.callId,
            msg.approvalDecision.decision as "approved" | "denied" | "timedOut",
          );
        }
      });
      call.on("end", () => channel.input.close());
      call.on("cancelled", () => channel.input.close());

      const loop = new AgentLoop({
        modelProvider,
        toolRegistry,
        approvalGate,
        channel,
        memory: memoryStore.createSession(),
        skills: skillCatalog,
        onEvent: (event) => call.write(toServerMessage(event)),
      });

      loop
        .run()
        .catch((error: unknown) => {
          call.destroy(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(() => {
          call.end();
        });
    },
  };

  return { server, close };
}
