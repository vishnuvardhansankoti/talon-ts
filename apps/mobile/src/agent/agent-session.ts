import { AgentLoop, type AgentEvent, type ChannelOutput } from "@talon/agent-core";
import { CloudTier, GeminiProvider } from "@talon/agent-providers";
import { MobileApprovalGate, type InlineApprovalBridge } from "./mobile-approval-gate";
import { MobileChannel } from "./mobile-channel";
import { NoopMobileMemory } from "./mobile-memory";
import { NoopMobileSkills } from "./mobile-skills";
import { MobileToolRegistry } from "./mobile-tools";

/** Flash-class model for Phase 3 — the small/fast tier of PRD §3.3's
 * escalation ladder; the full Local -> Small Cloud -> Premium Cloud router
 * itself is Phase 4 scope (§7.2), so this app only ever talks to one
 * provider instance today. */
const DEFAULT_MODEL_ID = "gemini-2.5-flash";

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

  constructor(apiKey: string, callbacks: AgentSessionCallbacks) {
    this.channel = new MobileChannel(callbacks.onOutput);
    this.onError = callbacks.onError;
    const modelProvider = new GeminiProvider(CloudTier.Small, DEFAULT_MODEL_ID, apiKey);

    this.loop = new AgentLoop({
      modelProvider,
      toolRegistry: new MobileToolRegistry(),
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
