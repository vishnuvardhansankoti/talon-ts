import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const STORAGE_KEY = "talon.tavily_api_key";

/**
 * Independent of ProviderSettings — this is a tool credential (web search),
 * not a model-provider choice, and applies regardless of whether the
 * selected provider is Gemini or Ollama. Optional: a session with no key
 * configured simply doesn't register the web search tool (see
 * `createWebSearchTool`'s only caller in `agent-session.ts`) rather than
 * registering a tool that always fails. Same storage split as
 * provider-settings.ts: `expo-secure-store` (Keychain/Keystore) on
 * device, `localStorage` under `expo start --web` (no secure-storage
 * backend there).
 */
export async function loadTavilyApiKey(): Promise<string | null> {
  return Platform.OS === "web" ? globalThis.localStorage?.getItem(STORAGE_KEY) ?? null : SecureStore.getItemAsync(STORAGE_KEY);
}

/** Pass `null` (or an empty string) to clear a previously-saved key. */
export async function saveTavilyApiKey(apiKey: string | null): Promise<void> {
  const value = apiKey?.trim();
  if (Platform.OS === "web") {
    if (value) globalThis.localStorage?.setItem(STORAGE_KEY, value);
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
    return;
  }
  if (value) await SecureStore.setItemAsync(STORAGE_KEY, value);
  else await SecureStore.deleteItemAsync(STORAGE_KEY);
}
