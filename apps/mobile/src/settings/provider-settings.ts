import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const STORAGE_KEY = "talon.provider_settings";

export type ProviderSettings =
  | { readonly provider: "gemini"; readonly apiKey: string }
  | { readonly provider: "ollama"; readonly baseUrl: string; readonly model: string };

/**
 * PRD §1.1: "a user-supplied key, never a vendor-operated proxy" — extends
 * to Ollama's connection details too, same reasoning: whichever provider
 * this app talks to, the user supplies and owns the credential/address,
 * nothing routes through a proxy of ours. `expo-secure-store` (iOS
 * Keychain / Android Keystore) is the real target; it has no web backend
 * at all, so `expo start --web` (this app's only verification path in
 * this environment — no device/simulator available, see
 * docs/architecture/phase-3-mobile.md) falls back to `localStorage`. That
 * fallback is explicitly dev-only and insecure — never the path a shipped
 * iOS/Android build takes.
 */
export async function loadProviderSettings(): Promise<ProviderSettings | null> {
  const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(STORAGE_KEY) ?? null : await SecureStore.getItemAsync(STORAGE_KEY);
  if (raw === null) return null;
  return JSON.parse(raw) as ProviderSettings;
}

export async function saveProviderSettings(settings: ProviderSettings): Promise<void> {
  const raw = JSON.stringify(settings);
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(STORAGE_KEY, raw);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, raw);
}

/**
 * A bare "host:port" (e.g. "localhost:11434", or even a typo'd
 * "192.168.1.90:11434") is a syntactically valid URL to the WHATWG parser
 * — "localhost"/"192.168.1.90" just get read as the *scheme*, not a host,
 * since nothing here signals "//"; `new URL(...)` neither throws nor
 * produces a `hostname`. That version saves fine and then fails at
 * request time with an opaque native "could not connect to the server"
 * error — found by actually hitting it on a real device, not inferred.
 * Requiring an explicit http(s):// scheme up front catches exactly that
 * mistake before it's ever saved.
 */
export function isValidOllamaBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}
