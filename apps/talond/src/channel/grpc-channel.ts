import type { Channel, ChannelInput, ChannelOutput } from "@talon/agent-core";
import type * as grpc from "@grpc/grpc-js";
import type { talon } from "@talon/grpc-contracts";
import { AsyncQueue } from "../async-queue.js";

/**
 * A network-shaped implementation of agent-core's Channel per gRPC session
 * (PRD §15.1's framing, applied to talond's own local/remote distinction).
 */
export class GrpcChannel implements Channel {
  readonly channelId = "grpc_session";
  readonly input = new AsyncQueue<ChannelInput>();

  constructor(private readonly call: grpc.ServerDuplexStream<talon.ClientMessage, talon.ServerMessage>) {}

  async emit(output: ChannelOutput): Promise<void> {
    this.call.write({ channelOutput: { text: output.text, isFinal: output.isFinal } });
  }
}
