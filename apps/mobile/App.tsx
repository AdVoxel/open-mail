import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  createMailApi,
  messageKey as key,
  replyFields,
  triageInBackground,
  type AccountId,
  type AccountInfo,
  type MailMessage,
  type MessageHeader,
  type TriageState,
} from "@mail-app/api-client";

// Points at the desktop app's local API, e.g. http://192.168.1.20:8787 (see .env.example).
const api = createMailApi(
  process.env.EXPO_PUBLIC_MAIL_API_URL ?? "",
  process.env.EXPO_PUBLIC_MAIL_APP_TOKEN ?? "",
);

export default function App() {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [accountId, setAccountId] = useState<AccountId | null>(null);
  const [headers, setHeaders] = useState<MessageHeader[]>([]);
  const [triage, setTriage] = useState<Record<string, TriageState>>({});
  const [open, setOpen] = useState<MessageHeader | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .accounts()
      .then((list) => {
        setAccounts(list);
        setAccountId(list[0]?.id ?? null);
      })
      .catch((e: Error) => setError(`Can't reach the desktop app: ${e.message}`));
  }, []);

  async function loadInbox() {
    if (!accountId) return;
    setRefreshing(true);
    try {
      setHeaders(await api.inbox(accountId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    setHeaders([]);
    void loadInbox();
  }, [accountId]);

  useEffect(
    () =>
      triageInBackground(
        api,
        headers.filter((h) => !triage[key(h)]),
        (k, state) => setTriage((t) => ({ ...t, [k]: state })),
      ),
    [headers],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!open) return false;
      setOpen(null);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="auto" />
        {open ? (
          <MessageScreen header={open} triage={triage[key(open)]} onBack={() => setOpen(null)} />
        ) : (
          <>
            <View style={styles.tabs}>
              {accounts.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => setAccountId(a.id)}
                  style={[styles.tab, a.id === accountId && styles.tabActive]}
                >
                  <Text style={a.id === accountId ? styles.tabTextActive : styles.tabText}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
            {error && <Text style={styles.error}>{error}</Text>}
            <FlatList
              data={headers}
              keyExtractor={(h) => key(h)}
              refreshing={refreshing}
              onRefresh={loadInbox}
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => setOpen(item)}>
                  <View style={styles.rowTop}>
                    <Text style={[styles.from, !item.seen && styles.bold]} numberOfLines={1}>
                      {item.from}
                    </Text>
                    <Text style={styles.muted}>{new Date(item.date).toLocaleDateString()}</Text>
                  </View>
                  <Text style={!item.seen && styles.bold} numberOfLines={1}>
                    {item.subject}
                  </Text>
                  <TriageLine state={triage[key(item)]} />
                </Pressable>
              )}
            />
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function TriageLine({ state }: { state: TriageState | undefined }) {
  if (!state || state === "loading") return <Text style={styles.muted}>Summarizing…</Text>;
  if (state === "error") return <Text style={styles.muted}>Summary unavailable</Text>;
  return (
    <View style={styles.triage}>
      <Text style={[styles.badge, state.priority === "high" && styles.badgeHigh]}>{state.priority}</Text>
      <Text style={[styles.muted, styles.flex]} numberOfLines={1}>
        {state.summary}
      </Text>
    </View>
  );
}

function MessageScreen({
  header,
  triage,
  onBack,
}: {
  header: MessageHeader;
  triage: TriageState | undefined;
  onBack: () => void;
}) {
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [instructions, setInstructions] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"drafting" | "sending" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api.message(header.accountId, header.uid).then(setMessage, (e: Error) => setStatus(e.message));
  }, [header]);

  async function generateDraft() {
    setBusy("drafting");
    setStatus(null);
    try {
      setDraft(await api.draft(header.accountId, header.uid, instructions || undefined));
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function confirmSend() {
    if (!message || !draft.trim()) return;
    Alert.alert("Send reply?", `To: ${message.from}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Send",
        onPress: async () => {
          setBusy("sending");
          try {
            await api.send(header.accountId, replyFields(message, draft));
            setDraft("");
            setStatus("Reply sent.");
          } catch (e) {
            setStatus((e as Error).message);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.reader} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onBack}>
        <Text style={styles.link}>‹ Inbox</Text>
      </Pressable>
      {!message ? (
        status ? <Text style={styles.error}>{status}</Text> : <ActivityIndicator style={styles.spinner} />
      ) : (
        <>
          <Text style={styles.title}>{message.subject}</Text>
          <Text style={styles.muted}>
            {message.from} · {new Date(message.date).toLocaleString()}
          </Text>

          {triage && typeof triage === "object" && (
            <View style={styles.aiBox}>
              <Text>{triage.summary}</Text>
              {triage.action_items.map((item) => (
                <Text key={item}>• {item}</Text>
              ))}
            </View>
          )}

          <Text style={styles.body}>{message.body}</Text>

          <TextInput
            style={styles.input}
            placeholder="How should I reply? (optional)"
            value={instructions}
            onChangeText={setInstructions}
          />
          <Pressable style={styles.button} onPress={generateDraft} disabled={busy !== null}>
            <Text>{busy === "drafting" ? "Drafting…" : "Draft reply with AI"}</Text>
          </Pressable>
          {draft !== "" && (
            <>
              <TextInput style={[styles.input, styles.draft]} multiline value={draft} onChangeText={setDraft} />
              <Pressable style={[styles.button, styles.primary]} onPress={confirmSend} disabled={busy !== null}>
                <Text style={styles.primaryText}>{busy === "sending" ? "Sending…" : "Send"}</Text>
              </Pressable>
            </>
          )}
          {status && <Text style={styles.muted}>{status}</Text>}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  flex: { flex: 1 },
  bold: { fontWeight: "600" },
  muted: { color: "#8a8a8e", fontSize: 13 },
  error: { color: "#d93025", padding: 16 },
  link: { color: "#0a66ff", fontSize: 16, marginBottom: 12 },
  spinner: { marginTop: 40 },
  tabs: { flexDirection: "row", gap: 8, padding: 12, borderBottomWidth: 1, borderColor: "#e3e3e8" },
  tab: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16, backgroundColor: "#f0f0f3" },
  tabActive: { backgroundColor: "#0a66ff" },
  tabText: { color: "#1c1c1e" },
  tabTextActive: { color: "#fff", fontWeight: "600" },
  row: { padding: 14, borderBottomWidth: 1, borderColor: "#e3e3e8", gap: 3 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  from: { flex: 1 },
  triage: { flexDirection: "row", alignItems: "center", gap: 6 },
  badge: {
    fontSize: 10,
    textTransform: "uppercase",
    paddingHorizontal: 5,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: "#e3e3e8",
  },
  badgeHigh: { backgroundColor: "#d93025", color: "#fff" },
  reader: { padding: 16, gap: 10 },
  title: { fontSize: 20, fontWeight: "600" },
  aiBox: { backgroundColor: "#f6f6f8", borderLeftWidth: 3, borderColor: "#0a66ff", padding: 10, gap: 4 },
  body: { fontSize: 15, lineHeight: 21 },
  input: { borderWidth: 1, borderColor: "#e3e3e8", borderRadius: 6, padding: 10 },
  draft: { minHeight: 160, textAlignVertical: "top" },
  button: { alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6, backgroundColor: "#f0f0f3" },
  primary: { backgroundColor: "#0a66ff" },
  primaryText: { color: "#fff", fontWeight: "600" },
});
