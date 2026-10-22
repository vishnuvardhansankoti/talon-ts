import { describe, expect, it, jest } from "@jest/globals";
import { MobileChannel } from "../src/agent/mobile-channel";

describe("MobileChannel", () => {
  it("emit() forwards straight to the onOutput callback", async () => {
    const onOutput = jest.fn();
    const channel = new MobileChannel(onOutput);
    await channel.emit({ text: "hello", isFinal: false });
    expect(onOutput).toHaveBeenCalledWith({ text: "hello", isFinal: false });
  });

  it("send() queues input that a not-yet-waiting consumer picks up later", async () => {
    const channel = new MobileChannel(() => {});
    channel.send("first");
    channel.send("second");

    const iterator = channel.input[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: { text: "first" }, done: false });
    await expect(iterator.next()).resolves.toEqual({ value: { text: "second" }, done: false });
  });

  it("send() resolves an already-waiting consumer immediately", async () => {
    const channel = new MobileChannel(() => {});
    const iterator = channel.input[Symbol.asyncIterator]();
    const pending = iterator.next();

    channel.send("late arrival");

    await expect(pending).resolves.toEqual({ value: { text: "late arrival" }, done: false });
  });
});
