import { describe, expect, it, jest } from "@jest/globals";

jest.mock("react-native", () => ({ Platform: { OS: "ios", Version: "18.0" } }));

const mockFileState = { exists: true, text: async (): Promise<string> => "file contents" };
const mockDirectoryState = { exists: true, entries: [{ name: "a.txt" }, { name: "b.txt" }] };

jest.mock("expo-file-system", () => {
  class File {
    constructor(..._parts: unknown[]) {}
    get exists() {
      return mockFileState.exists;
    }
    text() {
      return mockFileState.text();
    }
  }
  class Directory {
    constructor(..._parts: unknown[]) {}
    get exists() {
      return mockDirectoryState.exists;
    }
    list() {
      return mockDirectoryState.entries;
    }
  }
  return { File, Directory, Paths: { document: new Directory() } };
});

import { MobileToolRegistry } from "../src/agent/mobile-tools";

const ctx = { sessionId: "test", cancellation: new AbortController().signal };

describe("MobileToolRegistry", () => {
  it("lists exactly the three default mobile-safe tools, all safeReadOnly", () => {
    const registry = new MobileToolRegistry();
    const schemas = registry.listSchemas();
    expect(schemas.map((s) => s.id).sort()).toEqual(["device.info", "fs.list_dir", "fs.read_file"]);
    for (const id of ["device.info", "fs.read_file", "fs.list_dir"]) {
      expect(registry.resolveTier(id, {})).toBe("safeReadOnly");
    }
  });

  it("floors an unrecognized tool id at dangerousConfirmRequired, never a permissive default", () => {
    const registry = new MobileToolRegistry();
    expect(registry.resolveTier("shell.exec", {})).toBe("dangerousConfirmRequired");
  });

  it("reports TOOL_NOT_FOUND for an unregistered tool id — no shell.exec exists on mobile at all", async () => {
    const registry = new MobileToolRegistry();
    const result = await registry.execute("shell.exec", { command: "rm -rf /" }, ctx);
    expect(result).toEqual({
      success: false,
      errorCode: "TOOL_NOT_FOUND",
      errorMessage: 'no tool registered with id "shell.exec"',
    });
  });

  it("device.info returns platform/osVersion without touching the filesystem", async () => {
    const registry = new MobileToolRegistry();
    const result = await registry.execute("device.info", {}, ctx);
    expect(result).toEqual({ success: true, output: { platform: "ios", osVersion: "18.0" } });
  });

  describe("fs.read_file", () => {
    it("rejects a path that escapes the sandbox via '..' before ever touching the filesystem", async () => {
      const registry = new MobileToolRegistry();
      const result = await registry.execute("fs.read_file", { path: "../../etc/passwd" }, ctx);
      expect(result).toEqual({
        success: false,
        errorCode: "TOOL_VALIDATION_FAILED",
        errorMessage: "path escapes the sandboxed document directory",
      });
    });

    it("rejects an absolute path", async () => {
      const registry = new MobileToolRegistry();
      const result = await registry.execute("fs.read_file", { path: "/etc/passwd" }, ctx);
      expect(result.success).toBe(false);
    });

    it("rejects a missing or non-string path", async () => {
      const registry = new MobileToolRegistry();
      expect(await registry.execute("fs.read_file", {}, ctx)).toMatchObject({ errorCode: "TOOL_VALIDATION_FAILED" });
    });

    it("reads a file within the sandbox", async () => {
      mockFileState.exists = true;
      const registry = new MobileToolRegistry();
      const result = await registry.execute("fs.read_file", { path: "notes.txt" }, ctx);
      expect(result).toEqual({ success: true, output: "file contents" });
    });

    it("reports a clear error when the file doesn't exist", async () => {
      mockFileState.exists = false;
      const registry = new MobileToolRegistry();
      const result = await registry.execute("fs.read_file", { path: "missing.txt" }, ctx);
      expect(result).toEqual({ success: false, errorCode: "TOOL_EXECUTION_FAILED", errorMessage: "file does not exist" });
      mockFileState.exists = true;
    });
  });

  describe("fs.list_dir", () => {
    it("rejects a path that escapes the sandbox", async () => {
      const registry = new MobileToolRegistry();
      const result = await registry.execute("fs.list_dir", { path: "../.." }, ctx);
      expect(result.success).toBe(false);
    });

    it("lists entry names within the sandbox", async () => {
      mockDirectoryState.exists = true;
      const registry = new MobileToolRegistry();
      const result = await registry.execute("fs.list_dir", { path: "." }, ctx);
      expect(result).toEqual({ success: true, output: ["a.txt", "b.txt"] });
    });
  });
});
