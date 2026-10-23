import { afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: async () => {
    throw new Error("must not be called on web");
  },
  setItemAsync: async () => {
    throw new Error("must not be called on web");
  },
}));

import { loadProviderSettings, saveProviderSettings } from "../src/settings/provider-settings";

describe("provider-settings (web: localStorage fallback)", () => {
  const store = new Map<string, string>();

  beforeAll(() => {
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    } as unknown as Storage;
  });

  afterEach(() => {
    store.clear();
  });

  it("returns null when nothing has been saved", async () => {
    expect(await loadProviderSettings()).toBeNull();
  });

  it("round-trips through localStorage, never touching SecureStore", async () => {
    await saveProviderSettings({ provider: "gemini", apiKey: "AIza-fake" });
    expect(await loadProviderSettings()).toEqual({ provider: "gemini", apiKey: "AIza-fake" });
  });
});
