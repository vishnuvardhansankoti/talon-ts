import { AgentLoop, type AgentEvent, type ChannelOutput } from "@talon/agent-core";
// Deliberately bypassing @talon/agent-providers' barrel ("@talon/agent-providers")
// — its index.ts also re-exports the Node-only OllamaProvider (node:crypto,
// node:stream), and Metro evaluates a barrel's *entire* export graph when
// resolving any single named import from it, not just the one actually
// referenced. That pulled ollama-provider.js into this app's bundle and
// broke it on a real device/Expo Go ("No resolver is registered for the
// 'node:' URI scheme") even though nothing here ever imports OllamaProvider
// itself. These subpath imports keep this app's bundle graph from ever
// reaching that file at all.
import { CloudTier, type ModelProvider } from "@talon/agent-providers/contract";
import { GeminiProvider } from "@talon/agent-providers/gemini-provider";
import { MobileOllamaProvider } from "@talon/agent-providers/mobile-ollama-provider";
import { MobileApprovalGate, type InlineApprovalBridge } from "./mobile-approval-gate";
import { MobileChannel } from "./mobile-channel";
import { NoopMobileMemory } from "./mobile-memory";
import { NoopMobileSkills } from "./mobile-skills";
import { createWebSearchTool, DEFAULT_MOBILE_TOOLS, MobileToolRegistry } from "./mobile-tools";
import type { ProviderSettings } from "../settings/provider-settings";

/** Flash-class model for Phase 3 — the small/fast tier of PRD §3.3's
 * escalation ladder; the full Local -> Small Cloud -> Premium Cloud router
 * itself is Phase 4 scope (§7.2), so Gemini only ever talks to one model
 * id today. Ollama's model id is user-chosen instead (see SettingsScreen
 * in App.tsx) — there's no single "small tier" model name to default to
 * across whatever the user has pulled locally. */
const DEFAULT_GEMINI_MODEL_ID = "gemini-2.5-flash";

function toModelProvider(settings: ProviderSettings): ModelProvider {
  if (settings.provider === "gemini") {
    return new GeminiProvider(CloudTier.Small, DEFAULT_GEMINI_MODEL_ID, settings.apiKey);
  }
  return new MobileOllamaProvider(settings.model, new URL(settings.baseUrl));
}

export interface AgentSessionCallbacks extends InlineApprovalBridge {
  readonly onOutput: (output: ChannelOutput) => void;
  readonly onEvent?: (event: AgentEvent) => void;
  /** Called at most once, if `run()` ever rejects — e.g. a model-provider
   * network/auth failure. Desktop/CLI can recover from this by starting a
   * fresh `AgentLoop` for the *next* gRPC session; mobile has exactly one
   * long-lived loop for the app's whole lifetime, so without this the
   * failure would otherwise be invisible (console.error only) and
   * permanent — every message typed after it would silently go nowhere,
   * with the composer still showing enabled and no indication why nothing
   * ever responds again. Found by actually sending a message through this
   * app against a real (deliberately invalid) key, not inferred. */
  readonly onError: (error: unknown) => void;
}

/**
 * PRD §1.3/§1.4: the one place apps/mobile wires `@talon/agent-core`'s
 * loop in-process, mirroring apps/talond's `createTalonDaemonServer()` —
 * same shared package, same loop, different host runtime and a different
 * (mobile-only) set of port implementations plugged in.
 */
export class AgentSession {
  private readonly channel: MobileChannel;
  private readonly loop: AgentLoop;
  private readonly onError: (error: unknown) => void;
  private started = false;
  private ended = false;

  /**
   * `tavilyApiKey` is undefined when the user never configured one
   * (src/settings/tavily-settings.ts) — web.search is then simply absent
   * from the registry rather than present-but-always-failing, same
   * "don't propose what you can't do" reasoning as talond only merging a
   * tools.yaml-declared tool in when it actually connects.
   */
  constructor(settings: ProviderSettings, tavilyApiKey: string | undefined, callbacks: AgentSessionCallbacks) {
    this.channel = new MobileChannel(callbacks.onOutput);
    this.onError = callbacks.onError;
    const modelProvider = toModelProvider(settings);
    const tools = [...DEFAULT_MOBILE_TOOLS, ...(tavilyApiKey ? [createWebSearchTool(tavilyApiKey)] : [])];

    this.loop = new AgentLoop({
      modelProvider,
      toolRegistry: new MobileToolRegistry(tools),
      approvalGate: new MobileApprovalGate(callbacks),
      channel: this.channel,
      memory: new NoopMobileMemory(),
      skills: new NoopMobileSkills(),
      ...(callbacks.onEvent ? { onEvent: callbacks.onEvent } : {}),
    });
  }

  /** Starts the loop's long-lived run(); never awaited by the caller — it
   * only resolves if the channel's input ever completes (never, on
   * mobile) or `run()` throws, which ends the loop for good — there's no
   * per-session reconnect to fall back to here the way talond's gRPC
   * server gets one per stream. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.loop.run().catch((error: unknown) => {
      this.ended = true;
      this.onError(error);
    });
  }

  sendMessage(text: string): void {
    if (this.ended) {
      this.onError(new Error("the agent session has ended after a previous error — restart the app to continue"));
      return;
    }
    this.channel.send(text);
  }
}
