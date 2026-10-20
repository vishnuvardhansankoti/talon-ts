import type { AgentEvent, ApprovalDecisionPort, ChannelOutput, ProposedToolCall } from "@talon/agent-core";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AgentSession } from "./src/agent/agent-session";
import { loadApiKey, saveApiKey } from "./src/settings/api-key-store";

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

function ApiKeyPrompt({ onSaved }: { readonly onSaved: (apiKey: string) => void }): React.JSX.Element {
  const [value, setValue] = useState("");
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.centered}>
        <Text style={styles.title}>Enter your Gemini API key</Text>
        <Text style={styles.subtitle}>
          Stored on-device only (Keychain/Keystore) — PRD §1.1: a user-supplied key, never a vendor-operated proxy.
        </Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder="AIza..."
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <Button
          title="Save"
          disabled={value.trim().length === 0}
          onPress={() => {
            const key = value.trim();
            void saveApiKey(key).then(() => onSaved(key));
          }}
        />
      </View>
    </SafeAreaView>
  );
}

function ChatScreen({ apiKey }: { readonly apiKey: string }): React.JSX.Element {
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

    const session = new AgentSession(apiKey, { onOutput, onEvent, requestInlineApproval, onError });
    sessionRef.current = session;
    session.start();
  }, [apiKey]);

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

export default function App(): React.JSX.Element {
  const [apiKey, setApiKey] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void loadApiKey().then(setApiKey);
  }, []);

  if (apiKey === undefined) return <SafeAreaView style={styles.root} />;
  if (apiKey === null) return <ApiKeyPrompt onSaved={setApiKey} />;
  return <ChatScreen apiKey={apiKey} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  centered: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: "600" },
  subtitle: { fontSize: 13, opacity: 0.7 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, fontSize: 14 },
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
