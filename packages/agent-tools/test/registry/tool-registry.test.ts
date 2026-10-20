import { describe, expect, it } from "@jest/globals";
import {
  ToolDefinition,
  ToolSafetyTier,
  type ToolResult,
  type ToolValidationResult,
} from "../../src/base/tool-definition.js";
import { ToolRegistry } from "../../src/registry/tool-registry.js";

class StubTool extends ToolDefinition {
  readonly description = "stub";
  readonly inputSchema = {};
  readonly safetyTier = ToolSafetyTier.SafeReadOnly;

  constructor(public readonly id: string) {
    super();
  }

  validate(): ToolValidationResult {
    return { valid: true };
  }

  async execute(): Promise<ToolResult> {
    return { success: true, output: null };
  }
}

describe("ToolRegistry", () => {
  it("throws when constructed with two tools sharing an id", () => {
    expect(() => new ToolRegistry([new StubTool("dup.id"), new StubTool("dup.id")])).toThrow(/duplicate tool id/);
  });

  it("accepts distinct ids without throwing", () => {
    expect(() => new ToolRegistry([new StubTool("a"), new StubTool("b")])).not.toThrow();
  });

  it("catches a collision between a builtin-shaped tool and a config-shaped tool regardless of source", () => {
    // ToolRegistry can't tell builtin tools apart from config-declared ones —
    // that's the point: the guard is source-agnostic.
    expect(() => new ToolRegistry([new StubTool("shell.exec"), new StubTool("shell.exec")])).toThrow();
  });

  describe("reset", () => {
    it("atomically replaces the active tool set", () => {
      const registry = new ToolRegistry([new StubTool("a")]);
      registry.reset([new StubTool("b"), new StubTool("c")]);
      expect(registry.listSchemas().map((s) => s.id).sort()).toEqual(["b", "c"]);
    });

    it("rejects a duplicate id in the new set and leaves the previous set serving unchanged", () => {
      const registry = new ToolRegistry([new StubTool("a")]);
      expect(() => registry.reset([new StubTool("b"), new StubTool("b")])).toThrow(/duplicate tool id/);
      // Rejected atomically — "a" is still there, "b" never got committed.
      expect(registry.listSchemas().map((s) => s.id)).toEqual(["a"]);
    });
  });
});
