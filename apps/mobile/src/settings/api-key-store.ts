import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const STORAGE_KEY = "talon.gemini_api_key";

/**
 * PRD §1.1: "under a user-supplied API key, never a vendor-operated
 * proxy." `expo-secure-store` (iOS Keychain / Android Keystore) is the
 * real target; it has no web backend at all, so `expo start --web` (this
 * app's only verification path in this environment — no device/simulator
 * available, see docs/architecture/phase-3-mobile.md) falls back to
 * `localStorage`. That fallback is explicitly dev-only and insecure —
 * never the path a shipped iOS/Android build takes.
 */
export async function loadApiKey(): Promise<string | null> {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  }
  return SecureStore.getItemAsync(STORAGE_KEY);
}

export async function saveApiKey(apiKey: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(STORAGE_KEY, apiKey);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, apiKey);
}
