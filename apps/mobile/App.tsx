import type { AgentEvent, ApprovalDecisionPort, ChannelOutput, ProposedToolCall } from "@talon/agent-core";
import { useEffect, useRef, useState } from "react";
import { Button, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AgentSession } from "./src/agent/agent-session";
import {
  isValidOllamaBaseUrl,
  loadProviderSettings,
  saveProviderSettings,
  type ProviderSettings,
} from "./src/settings/provider-settings";
import { loadTavilyApiKey, saveTavilyApiKey } from "./src/settings/tavily-settings";

const DEFAULT_OLLAMA_MODEL = "qwen2.5:7b-instruct";

type TranscriptEntry =
  | { readonly kind: "user" | "assistant"; readonly text: string }
  | { readonly kind: "event"; readonly text: string }
  | { readonly kind: "error"; readonly text: string };

interface PendingApproval {
  readonly call: ProposedToolCall;
  readonly resolve: (decision: ApprovalDecisionPort) => void;
}

function describeEvent(event: AgentEvent): string | undefined {
  switch (event.kind) {
    case "StateTransitioned":
      return `[${event.from.kind} -> ${event.to.kind}]`;
    case "VerificationResult":
      return `[verify ${event.passed ? "passed" : "failed"}${event.reason ? `: ${event.reason}` : ""}]`;
    case "SkillSynthesized":
      return `[skill synthesized: ${event.accepted ? `accepted (${event.skillId})` : "rejected"}]`;
    default:
      return undefined;
  }
}

function SettingsScreen({
  initial,
  initialTavilyKey,
  onSaved,
  onCancel,
}: {
  readonly initial: ProviderSettings | null;
  readonly initialTavilyKey: string | null;
  readonly onSaved: (settings: ProviderSettings, tavilyApiKey: string | null) => void;
  readonly onCancel?: () => void;
}): React.JSX.Element {
  const [kind, setKind] = useState<ProviderSettings["provider"]>(initial?.provider ?? "gemini");
  const [apiKey, setApiKey] = useState(initial?.provider === "gemini" ? initial.apiKey : "");
  const [baseUrl, setBaseUrl] = useState(initial?.provider === "ollama" ? initial.baseUrl : "http://");
  const [model, setModel] = useState(initial?.provider === "ollama" ? initial.model : DEFAULT_OLLAMA_MODEL);
  const [tavilyKey, setTavilyKey] = useState(initialTavilyKey ?? "");

  const trimmedBaseUrl = baseUrl.trim();
  const baseUrlValid = isValidOllamaBaseUrl(trimmedBaseUrl);
  const canSave = kind === "gemini" ? apiKey.trim().length > 0 : baseUrlValid && model.trim().length > 0;

  function save(): void {
    const settings: ProviderSettings =
      kind === "gemini"
        ? { provider: "gemini", apiKey: apiKey.trim() }
        : { provider: "ollama", baseUrl: trimmedBaseUrl, model: model.trim() };
    const trimmedTavilyKey = tavilyKey.trim() || null;
    void Promise.all([saveProviderSettings(settings), saveTavilyApiKey(trimmedTavilyKey)]).then(() =>
      onSaved(settings, trimmedTavilyKey),
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.centered}>
        <Text style={styles.title}>Model provider</Text>
        <View style={styles.providerToggle}>
          <Button title="Gemini" onPress={() => setKind("gemini")} color={kind === "gemini" ? undefined : "#999"} />
          <Button title="Ollama" onPress={() => setKind("ollama")} color={kind === "ollama" ? undefined : "#999"} />
        </View>

        {kind === "gemini" ? (
          <>
            <Text style={styles.subtitle}>
              Stored on-device only (Keychain/Keystore) — PRD §1.1: a user-supplied key, never a vendor-operated proxy. Get
              one at Google AI Studio.
            </Text>
            <TextInput
              style={styles.input}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="AIza..."
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>
              Ollama has no iOS/Android build — point this at a machine already running it on your network (e.g. your
              laptop's LAN IP), not "localhost".
            </Text>
            <TextInput
              style={styles.input}
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder="http://192.168.1.50:11434"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {trimmedBaseUrl.length > 0 && !baseUrlValid && (
              <Text style={styles.validationError}>
                Must be a full URL with "http://" or "https://" — e.g. http://192.168.1.50:11434, not just
                192.168.1.50:11434 or "localhost".
              </Text>
            )}
            <TextInput
              style={styles.input}
              value={model}
              onChangeText={setModel}
              placeholder={DEFAULT_OLLAMA_MODEL}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </>
        )}

        <Text style={styles.title}>Web search (optional)</Text>
        <Text style={styles.subtitle}>
          Tavily API key — enables a web.search tool regardless of which model provider you picked above. Leave blank to
          skip it. Get one at app.tavily.com.
        </Text>
        <TextInput
          style={styles.input}
          value={tavilyKey}
          onChangeText={setTavilyKey}
          placeholder="tvly-..."
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <Button title="Save" disabled={!canSave} onPress={save} />
        {onCancel && <Button title="Cancel" onPress={onCancel} />}
      </View>
    </SafeAreaView>
  );
}

function ChatScreen({
  settings,
  tavilyApiKey,
  onRequestSettingsChange,
}: {
  readonly settings: ProviderSettings;
  readonly tavilyApiKey: string | null;
  readonly onRequestSettingsChange: () => void;
}): React.JSX.Element {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const sessionRef = useRef<AgentSession | null>(null);
  const assistantBubbleIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const onOutput = (output: ChannelOutput): void => {
      setTranscript((prev) => {
        if (assistantBubbleIndexRef.current === null) {
          assistantBubbleIndexRef.current = prev.length;
          return [...prev, { kind: "assistant", text: output.text }];
        }
        const next = [...prev];
        const index = assistantBubbleIndexRef.current;
        const existing = next[index];
        if (existing && existing.kind === "assistant") {
          next[index] = { kind: "assistant", text: existing.text + output.text };
        }
        return next;
      });
      if (output.isFinal) {
        assistantBubbleIndexRef.current = null;
      }
    };

    const onEvent = (event: AgentEvent): void => {
      const text = describeEvent(event);
      if (!text) return;
      setTranscript((prev) => [...prev, { kind: "event", text }]);
    };

    const requestInlineApproval = (call: ProposedToolCall): Promise<ApprovalDecisionPort> =>
      new Promise((resolve) => setPendingApproval({ call, resolve }));

    const onError = (error: unknown): void => {
      const text = error instanceof Error ? error.message : String(error);
      setTranscript((prev) => [...prev, { kind: "error", text }]);
    };

    const session = new AgentSession(settings, tavilyApiKey ?? undefined, { onOutput, onEvent, requestInlineApproval, onError });
    sessionRef.current = session;
    session.start();
  }, [settings, tavilyApiKey]);

  function send(): void {
    const text = draft.trim();
    if (!text || !sessionRef.current) return;
    setTranscript((prev) => [...prev, { kind: "user", text }]);
    sessionRef.current.sendMessage(text);
    setDraft("");
  }

  function resolveApproval(decision: ApprovalDecisionPort): void {
    pendingApproval?.resolve(decision);
    setPendingApproval(null);
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerText}>{settings.provider === "gemini" ? "Gemini" : `Ollama (${settings.model})`}</Text>
        <Button title="Change provider" onPress={onRequestSettingsChange} />
      </View>
      <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
        {transcript.map((entry, index) => {
          if (entry.kind === "event") {
            return (
              <View key={index} style={styles.eventLine}>
                <Text style={styles.eventText}>{entry.text}</Text>
              </View>
            );
          }
          if (entry.kind === "error") {
            return (
              <View key={index} style={styles.errorLine}>
                <Text style={styles.errorText}>{entry.text}</Text>
              </View>
            );
          }
          return (
            <View key={index} style={[styles.bubble, entry.kind === "user" ? styles.bubbleUser : styles.bubbleAssistant]}>
              <Text style={styles.bubbleText}>{entry.text}</Text>
            </View>
          );
        })}
      </ScrollView>

      {pendingApproval && (
        <View style={styles.approvalBanner}>
          <Text style={styles.approvalText}>
            {pendingApproval.call.toolId}: {JSON.stringify(pendingApproval.call.input)}
          </Text>
          <Button title="Deny" onPress={() => resolveApproval("denied")} />
          <Button title="Approve" onPress={() => resolveApproval("approved")} />
        </View>
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message Talon..."
          onSubmitEditing={send}
        />
        <Button title="Send" onPress={send} disabled={draft.trim().length === 0} />
      </View>
    </SafeAreaView>
  );
}

type AppMode = "chat" | "settings" | "pendingRestart";

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent(): React.JSX.Element {
  const [settings, setSettings] = useState<ProviderSettings | null | undefined>(undefined);
  const [tavilyApiKey, setTavilyApiKey] = useState<string | null | undefined>(undefined);
  // Once a ChatScreen/AgentSession exists, switching providers requires a
  // real app restart (not a live hot-swap — AgentSession wraps one
  // long-lived AgentLoop for the app's whole lifetime, with no
  // teardown/reconnect path the way talond's gRPC server gets one per
  // stream). "pendingRestart" is a dead-end on purpose: there is no path
  // back to "chat" from here without actually reloading the app, which is
  // what guarantees ChatScreen never mounts a second AgentSession
  // alongside one still running from before the provider changed. The
  // same restart requirement applies to a changed Tavily key, for the
  // same reason — MobileToolRegistry's tool set is also fixed at
  // AgentSession construction.
  const [mode, setMode] = useState<AppMode>("chat");

  useEffect(() => {
    void loadProviderSettings().then(setSettings);
    void loadTavilyApiKey().then(setTavilyApiKey);
  }, []);

  if (settings === undefined || tavilyApiKey === undefined) return <SafeAreaView style={styles.root} />;

  if (settings === null) {
    return (
      <SettingsScreen
        initial={null}
        initialTavilyKey={tavilyApiKey}
        onSaved={(s, t) => {
          setSettings(s);
          setTavilyApiKey(t);
        }}
      />
    );
  }

  if (mode === "settings") {
    return (
      <SettingsScreen
        initial={settings}
        initialTavilyKey={tavilyApiKey}
        onSaved={() => setMode("pendingRestart")}
        onCancel={() => setMode("chat")}
      />
    );
  }

  if (mode === "pendingRestart") {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.centered}>
          <Text style={styles.title}>Settings saved</Text>
          <Text style={styles.subtitle}>Close and reopen the app for the new provider to take effect.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <ChatScreen settings={settings} tavilyApiKey={tavilyApiKey} onRequestSettingsChange={() => setMode("settings")} />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  centered: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: "600" },
  subtitle: { fontSize: 13, opacity: 0.7 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, fontSize: 14 },
  validationError: { fontSize: 12, color: "#c0392b" },
  providerToggle: { flexDirection: "row", gap: 8 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerText: { fontSize: 12, opacity: 0.6 },
  transcript: { flex: 1 },
  transcriptContent: { padding: 12, gap: 8 },
  bubble: { maxWidth: "75%", padding: 10, borderRadius: 10 },
  bubbleUser: { alignSelf: "flex-end", backgroundColor: "#e1ecff" },
  bubbleAssistant: { alignSelf: "flex-start", backgroundColor: "#f0f0f0" },
  bubbleText: { fontSize: 15 },
  eventLine: { alignSelf: "center" },
  eventText: { fontSize: 11, opacity: 0.5, fontFamily: Platform.OS === "web" ? "monospace" : undefined },
  errorLine: { alignSelf: "center", maxWidth: "90%" },
  errorText: { fontSize: 12, color: "#c0392b", textAlign: "center" },
  approvalBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    backgroundColor: "#ffe8c2",
    borderTopWidth: 1,
    borderTopColor: "#e0a94a",
  },
  approvalText: { flex: 1, fontSize: 12 },
  composer: { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#eee" },
  composerInput: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10 },
});
