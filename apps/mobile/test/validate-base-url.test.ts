import { describe, expect, it } from "@jest/globals";
import { isValidOllamaBaseUrl } from "../src/settings/provider-settings";

describe("isValidOllamaBaseUrl", () => {
  it("accepts a well-formed http URL with an IP host and port", () => {
    expect(isValidOllamaBaseUrl("http://192.168.1.50:11434")).toBe(true);
  });

  it("accepts https too", () => {
    expect(isValidOllamaBaseUrl("https://ollama.example.com:11434")).toBe(true);
  });

  it("rejects a bare host:port with no scheme — the real bug found on a real device", () => {
    // Parses "successfully" as a URL whose *scheme* is "192.168.1.90" and
    // whose path is "11434" — no hostname at all, which is exactly how
    // this shipped a save-then-crash-on-connect bug the first time.
    expect(isValidOllamaBaseUrl("192.168.1.90:11434")).toBe(false);
  });

  it('rejects "localhost:11434" the same way, same reason', () => {
    expect(isValidOllamaBaseUrl("localhost:11434")).toBe(false);
  });

  it("rejects the bare default placeholder", () => {
    expect(isValidOllamaBaseUrl("http://")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidOllamaBaseUrl("")).toBe(false);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(isValidOllamaBaseUrl("ftp://192.168.1.50:11434")).toBe(false);
  });
});
