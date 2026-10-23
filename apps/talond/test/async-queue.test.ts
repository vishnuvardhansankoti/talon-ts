import { describe, expect, it } from "@jest/globals";
import { AsyncQueue } from "../src/async-queue.js";

describe("AsyncQueue", () => {
  it("buffers a value pushed before any consumer and delivers it on next()", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: 1, done: false });
  });

  it("resolves a pending next() as soon as a value is pushed", async () => {
    const queue = new AsyncQueue<string>();
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();
    queue.push("hello");
    await expect(pending).resolves.toEqual({ value: "hello", done: false });
  });

  it("preserves FIFO order across multiple pushes consumed via for-await", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.push(3);
    queue.close();

    const seen: number[] = [];
    for await (const value of queue) {
      seen.push(value);
    }
    expect(seen).toEqual([1, 2, 3]);
  });

  it("drains already-buffered values before signalling done, even after close()", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.close();

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: 1, done: false });
    await expect(iterator.next()).resolves.toEqual({ value: 2, done: false });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it("resolves every pending consumer with done:true on close()", async () => {
    const queue = new AsyncQueue<number>();
    const a = queue[Symbol.asyncIterator]().next();
    const b = queue[Symbol.asyncIterator]().next();

    queue.close();

    await expect(a).resolves.toEqual({ value: undefined, done: true });
    await expect(b).resolves.toEqual({ value: undefined, done: true });
  });

  it("returns done:true immediately for next() calls made after close() on an empty queue", async () => {
    const queue = new AsyncQueue<number>();
    queue.close();
    await expect(queue[Symbol.asyncIterator]().next()).resolves.toEqual({ value: undefined, done: true });
  });

  it("bridges async pushes (e.g. from a callback) into a live for-await loop", async () => {
    const queue = new AsyncQueue<number>();
    const seen: number[] = [];

    const consumer = (async () => {
      for await (const value of queue) {
        seen.push(value);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 0));
    queue.push(10);
    await new Promise((resolve) => setTimeout(resolve, 0));
    queue.push(20);
    queue.close();

    await consumer;
    expect(seen).toEqual([10, 20]);
  });
});
