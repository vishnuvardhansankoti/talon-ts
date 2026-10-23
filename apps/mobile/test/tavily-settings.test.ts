import { afterEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-native", () => ({ Platform: { OS: "ios", Version: "18.0" } }));
jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: async (key: string) => store.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      store.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      store.delete(key);
    },
    __store: store,
  };
});

import * as SecureStore from "expo-secure-store";
import { loadTavilyApiKey, saveTavilyApiKey } from "../src/settings/tavily-settings";

describe("tavily-settings", () => {
  afterEach(() => {
    (SecureStore as unknown as { __store: Map<string, string> }).__store.clear();
  });

  it("returns null when nothing has been saved", async () => {
    expect(await loadTavilyApiKey()).toBeNull();
  });

  it("round-trips a key through SecureStore", async () => {
    await saveTavilyApiKey("tvly-fake-key");
    expect(await loadTavilyApiKey()).toBe("tvly-fake-key");
  });

  it("trims whitespace before saving", async () => {
    await saveTavilyApiKey("  tvly-fake-key  ");
    expect(await loadTavilyApiKey()).toBe("tvly-fake-key");
  });

  it("clears a previously-saved key when passed null", async () => {
    await saveTavilyApiKey("tvly-fake-key");
    await saveTavilyApiKey(null);
    expect(await loadTavilyApiKey()).toBeNull();
  });

  it("treats an empty/whitespace-only string the same as clearing", async () => {
    await saveTavilyApiKey("tvly-fake-key");
    await saveTavilyApiKey("   ");
    expect(await loadTavilyApiKey()).toBeNull();
  });
});
