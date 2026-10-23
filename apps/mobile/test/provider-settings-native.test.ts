import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-native", () => ({ Platform: { OS: "ios", Version: "18.0" } }));
jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: async (key: string) => store.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      store.set(key, value);
    },
    __store: store,
  };
});

import * as SecureStore from "expo-secure-store";
import { loadProviderSettings, saveProviderSettings } from "../src/settings/provider-settings";

describe("provider-settings (native: expo-secure-store)", () => {
  afterEach(() => {
    (SecureStore as unknown as { __store: Map<string, string> }).__store.clear();
  });

  it("returns null when nothing has been saved", async () => {
    expect(await loadProviderSettings()).toBeNull();
  });

  it("round-trips a gemini settings object through SecureStore", async () => {
    await saveProviderSettings({ provider: "gemini", apiKey: "AIza-fake" });
    expect(await loadProviderSettings()).toEqual({ provider: "gemini", apiKey: "AIza-fake" });
  });

  it("round-trips an ollama settings object through SecureStore", async () => {
    await saveProviderSettings({ provider: "ollama", baseUrl: "http://192.168.1.50:11434", model: "qwen2.5:7b-instruct" });
    expect(await loadProviderSettings()).toEqual({
      provider: "ollama",
      baseUrl: "http://192.168.1.50:11434",
      model: "qwen2.5:7b-instruct",
    });
  });
});
