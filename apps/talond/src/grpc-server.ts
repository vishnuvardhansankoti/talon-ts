import type * as grpc from "@grpc/grpc-js";
import { AgentLoop, type AgentEvent } from "@talon/agent-core";
import { ApprovalGate, ToolRegistry, builtinTools } from "@talon/agent-tools";
import { OllamaProvider } from "@talon/agent-providers";
import { talon } from "@talon/grpc-contracts";
import { GrpcApprovalPrompter } from "./approval/grpc-approval-bridge.js";
import { GrpcChannel } from "./channel/grpc-channel.js";

export interface TalondConfig {
  readonly model: string;
  readonly projectRoot: string;
  readonly ollamaBaseUrl?: URL;
}

function toServerMessage(event: AgentEvent): talon.ServerMessage {
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
  }
}

export function createTalonDaemonServer(config: TalondConfig): talon.TalonDaemonServer {
  const toolRegistry = new ToolRegistry(builtinTools(config.projectRoot));
  const modelProvider = new OllamaProvider(config.model, config.ollamaBaseUrl);

  return {
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
}
