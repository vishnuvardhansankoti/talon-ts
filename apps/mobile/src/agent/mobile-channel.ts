import type { Channel, ChannelInput, ChannelOutput } from "@talon/agent-core";

/**
 * Bridges a callback-style producer (the composer's "send" button) into an
 * AsyncIterable — the same shape as apps/talond's AsyncQueue
 * (apps/talond/src/async-queue.ts), reimplemented here rather than shared:
 * this is the second place this exact small pattern lives, not the third
 * (phase-1.md §8's own threshold for when duplication beats a package).
 * Never closes — a mobile session runs for the app's lifetime, same as
 * GrpcChannel runs for one gRPC stream's lifetime.
 */
class AsyncQueue<T> {
  private readonly buffer: T[] = [];
  private resolvers: Array<(result: IteratorResult<T>) => void> = [];

  push(value: T): void {
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value, done: false });
    } else {
      this.buffer.push(value);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const queued = this.buffer.shift();
        if (queued !== undefined) return Promise.resolve({ value: queued, done: false });
        return new Promise((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}

/** PRD §1.3/§1.4: on mobile, `agent-core` runs in-process — there's no
 * gRPC session to bridge, just the composer's text input and the chat
 * transcript's rendered output. */
export class MobileChannel implements Channel {
  readonly channelId = "mobile";
  readonly input = new AsyncQueue<ChannelInput>();

  constructor(private readonly onOutput: (output: ChannelOutput) => void) {}

  send(text: string): void {
    this.input.push({ text });
  }

  async emit(output: ChannelOutput): Promise<void> {
    this.onOutput(output);
  }
}
