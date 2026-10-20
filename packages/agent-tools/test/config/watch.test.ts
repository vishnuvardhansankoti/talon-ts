import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import { watchToolsFromYaml } from "../../src/config/watch.js";

const VALID_A = 'tools:\n  - kind: exec\n    id: fixture.a\n    description: a\n    command: node\n    args: []\n    inputSchema: { type: object, properties: {} }\n';
const VALID_B = 'tools:\n  - kind: exec\n    id: fixture.b\n    description: b\n    command: node\n    args: []\n    inputSchema: { type: object, properties: {} }\n';
const INVALID = "tools:\n  - kind: bogus\n";

async function waitUntil(predicate: () => boolean, timeoutMs = 4000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitUntil: condition never became true");
}

describe("watchToolsFromYaml", () => {
  it("loads the initial config and reports its tools", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "talon-watch-"));
    const filePath = path.join(dir, "tools.yaml");
    await writeFile(filePath, VALID_A, "utf8");

    const handle = await watchToolsFromYaml(filePath, process.cwd());
    try {
      expect(handle.tools.map((t) => t.id)).toEqual(["fixture.a"]);
    } finally {
      await handle.close();
    }
  });

  it("reloads and calls onReload when the file changes to a new valid config", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "talon-watch-"));
    const filePath = path.join(dir, "tools.yaml");
    await writeFile(filePath, VALID_A, "utf8");

    const reloads: string[][] = [];
    const handle = await watchToolsFromYaml(filePath, process.cwd(), {
      debounceMs: 30,
      onReload: (tools) => reloads.push(tools.map((t) => t.id)),
    });
    try {
      await writeFile(filePath, VALID_B, "utf8");
      await waitUntil(() => reloads.length > 0);
      expect(reloads[0]).toEqual(["fixture.b"]);
    } finally {
      await handle.close();
    }
  });

  it("keeps serving the previous tools and calls onError when a reload is invalid", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "talon-watch-"));
    const filePath = path.join(dir, "tools.yaml");
    await writeFile(filePath, VALID_A, "utf8");

    const reloads: string[][] = [];
    const errors: unknown[] = [];
    const handle = await watchToolsFromYaml(filePath, process.cwd(), {
      debounceMs: 30,
      onReload: (tools) => reloads.push(tools.map((t) => t.id)),
      onError: (error) => errors.push(error),
    });
    try {
      await writeFile(filePath, INVALID, "utf8");
      await waitUntil(() => errors.length > 0);
      expect(reloads).toHaveLength(0);

      // A later *valid* edit still reloads fine — one bad edit doesn't
      // permanently wedge the watcher.
      await writeFile(filePath, VALID_B, "utf8");
      await waitUntil(() => reloads.length > 0);
      expect(reloads[0]).toEqual(["fixture.b"]);
    } finally {
      await handle.close();
    }
  });

  it("coalesces rapid successive writes within the debounce window into one reload", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "talon-watch-"));
    const filePath = path.join(dir, "tools.yaml");
    await writeFile(filePath, VALID_A, "utf8");

    const reloads: string[][] = [];
    const handle = await watchToolsFromYaml(filePath, process.cwd(), {
      debounceMs: 150,
      onReload: (tools) => reloads.push(tools.map((t) => t.id)),
    });
    try {
      await writeFile(filePath, VALID_A, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 20));
      await writeFile(filePath, VALID_B, "utf8");

      await waitUntil(() => reloads.length > 0);
      // Give any extra (wrongly-coalesced) reload a chance to fire before
      // asserting there was only ever one.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(reloads).toHaveLength(1);
      expect(reloads[0]).toEqual(["fixture.b"]);
    } finally {
      await handle.close();
    }
  });

  it("stops reloading once closed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "talon-watch-"));
    const filePath = path.join(dir, "tools.yaml");
    await writeFile(filePath, VALID_A, "utf8");

    const reloads: string[][] = [];
    const handle = await watchToolsFromYaml(filePath, process.cwd(), {
      debounceMs: 30,
      onReload: (tools) => reloads.push(tools.map((t) => t.id)),
    });
    await handle.close();

    await writeFile(filePath, VALID_B, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(reloads).toHaveLength(0);
  });

  it("picks up a new file added to a watched directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "talon-watch-dir-"));
    await writeFile(path.join(dir, "a.yaml"), VALID_A, "utf8");

    const reloads: string[][] = [];
    const handle = await watchToolsFromYaml(dir, process.cwd(), {
      debounceMs: 30,
      onReload: (tools) => reloads.push(tools.map((t) => t.id).sort()),
    });
    try {
      expect(handle.tools.map((t) => t.id)).toEqual(["fixture.a"]);

      await writeFile(path.join(dir, "b.yaml"), VALID_B, "utf8");
      await waitUntil(() => reloads.length > 0);
      expect(reloads[0]).toEqual(["fixture.a", "fixture.b"]);
    } finally {
      await handle.close();
    }
  });
});
