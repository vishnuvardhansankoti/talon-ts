import { describe, expect, it, jest } from "@jest/globals";
import type * as grpc from "@grpc/grpc-js";
import type { talon } from "@talon/grpc-contracts";
import { GrpcChannel } from "../src/channel/grpc-channel.js";

function fakeCall(): grpc.ServerDuplexStream<talon.ClientMessage, talon.ServerMessage> & { write: jest.Mock } {
  return { write: jest.fn() } as unknown as grpc.ServerDuplexStream<talon.ClientMessage, talon.ServerMessage> & {
    write: jest.Mock;
  };
}

describe("GrpcChannel", () => {
  it("exposes a fixed channelId", () => {
    const channel = new GrpcChannel(fakeCall());
    expect(channel.channelId).toBe("grpc_session");
  });

  it("emit() writes a channelOutput message with the given text and isFinal flag", async () => {
    const call = fakeCall();
    const channel = new GrpcChannel(call);

    await channel.emit({ text: "hello", isFinal: false });
    expect(call.write).toHaveBeenCalledWith({ channelOutput: { text: "hello", isFinal: false } });

    await channel.emit({ text: "done", isFinal: true });
    expect(call.write).toHaveBeenCalledWith({ channelOutput: { text: "done", isFinal: true } });
    expect(call.write).toHaveBeenCalledTimes(2);
  });

  it("input is an AsyncQueue that can be pushed into and iterated", async () => {
    const channel = new GrpcChannel(fakeCall());
    channel.input.push({ text: "line one" });

    const iterator = channel.input[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: { text: "line one" }, done: false });
  });
});
