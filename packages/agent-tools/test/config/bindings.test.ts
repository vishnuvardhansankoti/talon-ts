import { afterEach, describe, expect, it } from "@jest/globals";
import { resolveEnvRef, resolveHeaderValue, resolveInputRef, resolveSecretRef } from "../../src/config/bindings.js";

describe("resolveInputRef", () => {
  it("passes a literal through unchanged (as a string)", () => {
    expect(resolveInputRef("literal", {})).toBe("literal");
  });

  it("resolves a {fromInput} reference against validated input", () => {
    expect(resolveInputRef({ fromInput: "city" }, { city: "Austin" })).toBe("Austin");
  });

  it("carries a value containing shell/URL metacharacters through verbatim", () => {
    const dangerous = "; rm -rf / #";
    expect(resolveInputRef({ fromInput: "cmd" }, { cmd: dangerous })).toBe(dangerous);
  });

  it("throws if the referenced input field is missing", () => {
    expect(() => resolveInputRef({ fromInput: "missing" }, {})).toThrow(/missing/);
  });
});

describe("resolveEnvRef", () => {
  const ENV_VAR = "TALON_TEST_BINDINGS_SECRET";

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it("resolves a set env var", () => {
    process.env[ENV_VAR] = "secret-value";
    expect(resolveEnvRef({ fromEnv: ENV_VAR })).toBe("secret-value");
  });

  it("applies an optional prefix", () => {
    process.env[ENV_VAR] = "secret-value";
    expect(resolveEnvRef({ fromEnv: ENV_VAR, prefix: "Bearer " })).toBe("Bearer secret-value");
  });

  it("throws if the env var is not set", () => {
    expect(() => resolveEnvRef({ fromEnv: ENV_VAR })).toThrow(/not set/);
  });
});

describe("resolveSecretRef", () => {
  it("resolves a secret present in the loaded map", () => {
    const secrets = new Map([["WEATHER_API_KEY", "sk-abc123"]]);
    expect(resolveSecretRef({ fromSecret: "WEATHER_API_KEY" }, secrets)).toBe("sk-abc123");
  });

  it("applies an optional prefix", () => {
    const secrets = new Map([["WEATHER_API_KEY", "sk-abc123"]]);
    expect(resolveSecretRef({ fromSecret: "WEATHER_API_KEY", prefix: "Bearer " }, secrets)).toBe("Bearer sk-abc123");
  });

  it("throws if no secrets map was supplied at all", () => {
    expect(() => resolveSecretRef({ fromSecret: "WEATHER_API_KEY" }, undefined)).toThrow(/no secrets file/);
  });

  it("throws if the name is absent from the loaded map", () => {
    expect(() => resolveSecretRef({ fromSecret: "MISSING" }, new Map())).toThrow(/not present/);
  });
});

describe("resolveHeaderValue", () => {
  it("dispatches {fromEnv}, {fromSecret}, and plain/{fromInput} values correctly", () => {
    const ENV_VAR = "TALON_TEST_BINDINGS_HEADER_ENV";
    process.env[ENV_VAR] = "env-value";
    try {
      expect(resolveHeaderValue({ fromEnv: ENV_VAR }, {})).toBe("env-value");
      expect(resolveHeaderValue({ fromSecret: "s" }, {}, new Map([["s", "secret-value"]]))).toBe("secret-value");
      expect(resolveHeaderValue({ fromInput: "city" }, { city: "Austin" })).toBe("Austin");
      expect(resolveHeaderValue("literal", {})).toBe("literal");
    } finally {
      delete process.env[ENV_VAR];
    }
  });
});
