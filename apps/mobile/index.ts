import { randomUUID } from "expo-crypto";
import { registerRootComponent } from "expo";
import App from "./App";

/**
 * Hermes under Expo Go doesn't reliably provide a working `globalThis.crypto`
 * the way a browser does — `agent-core`'s `AgentLoop` (session id) and both
 * model providers' tool-call-id minting (`gemini-provider.ts`,
 * `mobile-ollama-provider.ts`) all call `globalThis.crypto.randomUUID()`
 * unconditionally, assuming a Web Crypto-compatible environment. That's
 * fine on `talond` (Node) and under `expo start --web` (real browser
 * WebCrypto) — which is why this was never caught there — but crashes
 * immediately on a real device/Expo Go with "Cannot read property
 * 'randomUUID' of undefined". Patching it here, once, before App (and
 * everything it transitively imports) ever runs, fixes every call site at
 * once without touching agent-core's platform-neutral contract or either
 * provider. `expo-crypto`'s `randomUUID()` matches Web Crypto's signature
 * exactly, so this is a drop-in fix, not a different code path.
 */
if (typeof globalThis.crypto?.randomUUID !== "function") {
  (globalThis as unknown as { crypto: { randomUUID: typeof randomUUID } }).crypto = { randomUUID };
}

registerRootComponent(App);
