export interface ChannelInput {
  readonly text: string;
}

export interface ChannelOutput {
  readonly text: string;
  readonly isFinal: boolean;
}

/**
 * Transport abstraction (PRD §14.1). OBSERVE only ever sees ChannelInput.text
 * — it never branches on channelId or on whether the implementation is a
 * gRPC-backed session, a CLI stdin loop, or (later) a voice channel.
 */
export interface Channel {
  readonly channelId: string;
  readonly input: AsyncIterable<ChannelInput>;
  emit(output: ChannelOutput): Promise<void>;
}
