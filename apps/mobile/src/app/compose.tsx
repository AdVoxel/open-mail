import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { CalendarClock, Minus, Paperclip, Send, Trash2, X } from "lucide-react-native";
import {
  draftToHtml,
  formatAddress,
  forwardDraft,
  hasQuote,
  messageKey,
  replyDraft,
  stripQuote,
  type OutgoingMail,
} from "@mail-app/api-client";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { ColorDot, Header, IconButton, Loading, Segmented, useConfirm, useNotify, type NotifyOptions } from "@/src/components/kit";
import { RichEditor } from "@/src/components/RichEditor";
import { SignaturePreview } from "@/src/components/SignaturePreview";
import { pickFiles, type PickedFile } from "@/src/components/pickFiles";
import { SchedulePicker } from "@/src/components/SchedulePicker";
import { useApi, useConnection } from "@/src/lib/connection";
import { formatSize, formatWhen } from "@/src/lib/format";
import { useDrafts, type ComposeParams, type MinimizedDraft } from "@/src/lib/drafts";
import { useSendDelay } from "@/src/lib/sendDelay";
import { useAutoDrafts, useSignaturePosition, useTrackOpens } from "@/src/lib/composePrefs";
import { useMail } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";

type Mode = "new" | "reply" | "replyAll" | "forward" | "edit" | "draft";

const TITLES: Record<Mode, string> = {
  new: "New message",
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
  edit: "Edit scheduled message",
  draft: "Draft",
};

type ServerDraft = { accountId: string; folder: string; uid: number };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="min-h-12 flex-row items-center gap-3 border-b border-border/70 px-1">
      <Text size="sm" className="w-14 text-muted-foreground">
        {label}
      </Text>
      <View className="flex-1 flex-row items-center">{children}</View>
    </View>
  );
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

export default function ComposeScreen() {
  const params = useLocalSearchParams<{
    mode?: Mode;
    accountId?: string;
    folder?: string;
    uid?: string;
    scheduledId?: string;
    /** A draft minimized to a bar, being reopened. */
    draft?: string;
  }>();
  const drafts = useDrafts();
  const [sendDelay] = useSendDelay();
  const [autoDrafts] = useAutoDrafts();
  const [trackByDefault] = useTrackOpens();
  /** This message gets the open-tracking pixel (default from Settings). */
  const [track, setTrack] = useState<boolean | null>(null);
  const tracking = track ?? trackByDefault;
  const { connection } = useConnection();
  // Recipients must reach the pixel: a server on this computer can't be.
  const serverIsLocal = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(connection?.url ?? "");
  const [signaturePosition, setSignaturePosition] = useSignaturePosition();
  const mode: Mode = params.mode ?? "new";
  const api = useApi();
  const notify = useNotify();
  const confirm = useConfirm();
  const colors = useColors();
  const { accounts, mailbox, updateMessage } = useMail();

  const [from, setFrom] = useState(params.accountId ?? mailbox.accountId ?? accounts[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  /** The formatted body from the web/desktop editor; null on phones (plain text only). */
  const [html, setHtml] = useState<string | null>(null);
  /** What the editor starts from; a new `version` reloads it. */
  const [seed, setSeed] = useState({ html: "", text: "", version: 0 });
  const [threading, setThreading] = useState<Pick<OutgoingMail, "inReplyTo" | "references">>({});
  const [attachments, setAttachments] = useState<PickedFile[]>([]);
  const [sendAt, setSendAt] = useState<Date | undefined>();
  const [loading, setLoading] = useState(mode !== "new");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Add the From account's signature (applied by the server when the mail goes out). */
  const [withSignature, setWithSignature] = useState(true);
  const signature = accounts.find((a) => a.id === from)?.signature.trim() ?? "";

  // Drafts: what you write is saved to the account's Drafts folder a few seconds after you stop.
  /** The copy in the Drafts folder (replaced on each save, removed when sent or discarded). */
  const serverDraft = useRef<ServerDraft | null>(null);
  /** You changed something (a prefilled reply isn't saved until you do). */
  const edited = useRef(false);
  /** The editor reports its content once when it loads; that isn't an edit. */
  const editorLoaded = useRef(false);
  /** Sent or discarded: no more saves. */
  const finished = useRef(false);
  const lastSaved = useRef("");
  const saving = useRef<Promise<boolean>>(Promise.resolve(true));
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  /** Why the last save failed (shown in the header until a save works). */
  const [draftError, setDraftError] = useState<string | null>(null);
  const markEdited = <T,>(set: (value: T) => void) => (value: T) => {
    edited.current = true;
    set(value);
  };

  useEffect(() => {
    if (!from && accounts[0]) setFrom(accounts[0].id);
  }, [accounts, from]);

  // Prefill for replies, forwards and scheduled edits; or everything, for a reopened minimized draft.
  useEffect(() => {
    const draft = params.draft ? drafts.get(params.draft) : undefined;
    if (draft) {
      setFrom(draft.from);
      setTo(draft.to);
      setCc(draft.cc);
      setBcc(draft.bcc);
      setShowCc(draft.showCc);
      setSubject(draft.subject);
      setText(draft.text);
      setHtml(draft.html);
      editorLoaded.current = false;
      setSeed((s) => ({ html: draft.html ?? draftToHtml(draft.text), text: draft.text, version: s.version + 1 }));
      setThreading(draft.threading);
      setAttachments(draft.attachments);
      setSendAt(draft.sendAt);
      setWithSignature(draft.withSignature);
      serverDraft.current = draft.serverDraft ?? null;
      edited.current = true;
      setLoading(false);
      drafts.remove(draft.id);
      return;
    }
    let cancelled = false;
    const fill = (mail: Partial<OutgoingMail>) => {
      setTo(mail.to ?? "");
      setCc(mail.cc ?? "");
      setBcc(mail.bcc ?? "");
      setShowCc(Boolean(mail.cc || mail.bcc));
      setSubject(mail.subject ?? "");
      setText(mail.text ?? "");
      editorLoaded.current = false; // the reloaded editor's first report isn't an edit
      setSeed((s) => ({ html: mail.html ?? draftToHtml(mail.text ?? ""), text: mail.text ?? "", version: s.version + 1 }));
      setThreading({ inReplyTo: mail.inReplyTo, references: mail.references });
      if (mail.signature !== undefined) setWithSignature(mail.signature);
    };
    (async () => {
      try {
        if (mode === "edit" && params.scheduledId) {
          const item = await api.scheduledItem(params.scheduledId);
          if (cancelled) return;
          fill({ ...item, signature: item.signature ?? false });
          setFrom(item.accountId);
          setSendAt(new Date(item.sendAt));
          setAttachments((item.attachments ?? []).map((a) => ({ ...a, size: Math.floor((a.content.length * 3) / 4) })));
        } else if (mode === "draft" && params.accountId && params.folder && params.uid) {
          const message = await api.message(params.accountId, params.folder, Number(params.uid));
          if (cancelled) return;
          fill({
            to: message.to.map(formatAddress).join(", "),
            cc: message.cc.map(formatAddress).join(", "),
            subject: message.subject === "(no subject)" ? "" : message.subject,
            text: message.text,
            html: message.html ?? undefined,
            inReplyTo: message.references.at(-1),
            references: message.references,
          });
          setFrom(params.accountId);
          setAttachments([]);
          serverDraft.current = { accountId: params.accountId, folder: params.folder, uid: Number(params.uid) };
        } else if (mode !== "new" && params.accountId && params.folder && params.uid) {
          const message = await api.message(params.accountId, params.folder, Number(params.uid));
          if (cancelled) return;
          const own = accounts.find((a) => a.id === params.accountId)?.address ?? "";
          fill(mode === "forward" ? forwardDraft(message) : replyDraft(message, own, mode === "replyAll"));
        }
      } catch (e) {
        notify("Couldn't load the message", (e as Error).message, "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, mode, params.scheduledId, params.accountId, params.folder, params.uid, params.draft]);

  /** Keeps the draft in a bar at the bottom of the screen and goes back to the mail. */
  /** Everything on the screen, to minimize it or bring it back after Undo. */
  const snapshot = (): Omit<MinimizedDraft, "id"> => ({
    params: { mode, accountId: params.accountId, folder: params.folder, uid: params.uid, scheduledId: params.scheduledId },
    from,
    to,
    cc,
    bcc,
    showCc,
    subject,
    text,
    html,
    threading,
    attachments,
    sendAt,
    withSignature,
    serverDraft: serverDraft.current,
  });

  const minimize = () => {
    void saveDraft();
    drafts.minimize({ ...snapshot(), id: params.draft });
    close();
  };

  const mail = (): OutgoingMail => ({
    to: to.trim(),
    cc: cc.trim() || undefined,
    bcc: bcc.trim() || undefined,
    subject: subject.trim(),
    text,
    html: html ?? undefined,
    signature: withSignature && Boolean(signature),
    signaturePosition,
    track: tracking,
    ...threading,
    attachments: attachments.length ? attachments.map(({ filename, contentType, content }) => ({ filename, contentType, content })) : undefined,
  });

  // ------------------------------------------------------------ drafts

  const contentKey = () =>
    JSON.stringify([from, to, cc, bcc, subject, text, html, attachments.map((a) => `${a.filename}:${a.size}`)]);
  // Saves and the page-close handler read the latest values from here.
  const current = useRef({ from, mail: mail(), key: contentKey() });
  current.current = { from, mail: mail(), key: contentKey() };

  /** Saves to the Drafts folder (one save at a time; nothing when unchanged). Resolves false when it failed. */
  const saveDraft = useCallback((options: { keepalive?: boolean } = {}): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      const { from: account, mail: outgoing, key } = current.current;
      if (finished.current || !edited.current || !account || key === lastSaved.current) return true;
      try {
        const previous = serverDraft.current;
        if (previous && previous.accountId !== account) {
          // Now from another account: its copy goes from the old account's Drafts.
          await api.discardDraft(previous.accountId, previous.folder, previous.uid).catch(() => undefined);
          serverDraft.current = null;
        }
        const saved = await api.saveDraft(account, outgoing, serverDraft.current ?? undefined, options);
        serverDraft.current = saved.uid ? { accountId: account, folder: saved.folder, uid: saved.uid } : null;
        lastSaved.current = key;
        setSavedAt(new Date());
        setDraftError(null);
        return true;
      } catch (e) {
        const message = (e as Error).message;
        // An out-of-date server doesn't know the drafts endpoint.
        setDraftError(message === "Not found" ? "the server is out of date, restart it" : message);
        return false;
      }
    };
    saving.current = saving.current.then(run, run);
    return saving.current;
  }, [api]);

  /** After sending or discarding: no more saves, and the Drafts copy goes. */
  const dropDraft = useCallback(async () => {
    finished.current = true;
    await saving.current;
    const copy = serverDraft.current;
    serverDraft.current = null;
    if (copy) await api.discardDraft(copy.accountId, copy.folder, copy.uid).catch(() => undefined);
  }, [api]);

  // Save a few seconds after you stop typing (scheduled-mail edits live in Scheduled, not Drafts).
  useEffect(() => {
    if (!autoDrafts || loading || mode === "edit" || !edited.current) return;
    const timer = setTimeout(() => void saveDraft(), 3000);
    return () => clearTimeout(timer);
  }, [autoDrafts, loading, mode, saveDraft, from, to, cc, bcc, subject, text, html, attachments]);

  // The window or app closing: save what's there right away.
  useEffect(() => {
    if (!autoDrafts || mode === "edit") return;
    const now = () => void saveDraft({ keepalive: true });
    const sub = AppState.addEventListener("change", (state) => state !== "active" && now());
    if (Platform.OS === "web") {
      window.addEventListener("beforeunload", now);
      window.addEventListener("pagehide", now);
    }
    return () => {
      sub.remove();
      if (Platform.OS === "web") {
        window.removeEventListener("beforeunload", now);
        window.removeEventListener("pagehide", now);
      }
    };
  }, [autoDrafts, mode, saveDraft]);

  const removeQuote = () => {
    const stripped = stripQuote(html, text);
    edited.current = true;
    setText(stripped.text);
    setHtml(stripped.html);
    setSeed((s) => ({ html: stripped.html ?? draftToHtml(stripped.text), text: stripped.text, version: s.version + 1 }));
  };

  const validate = (): boolean => {
    if (!from) {
      notify("Add an account first", "Accounts are added in Settings.", "error");
      return false;
    }
    if (!to.trim()) {
      notify("Add a recipient", undefined, "error");
      return false;
    }
    return true;
  };

  const markAnswered = () => {
    if ((mode === "reply" || mode === "replyAll") && params.accountId && params.folder && params.uid) {
      const ref = { accountId: params.accountId, folder: params.folder, uid: Number(params.uid) };
      updateMessage(messageKey(ref), { answered: true });
      void api.setFlags(ref.accountId, ref.folder, ref.uid, { answered: true }).catch(() => {});
    }
  };

  type Done = string | { title: string; description?: string; options?: NotifyOptions };

  async function act(action: () => Promise<Done>) {
    if (!validate()) return;
    setBusy(true);
    try {
      const done = await action();
      void dropDraft();
      if (typeof done === "string") notify(done);
      else notify(done.title, done.description, "info", done.options);
      close();
    } catch (e) {
      notify("Not sent", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  /** Undo for a delayed send: cancel it and reopen what was written (unless it already went). */
  const undoSend = async (scheduledId: string, draft: Omit<MinimizedDraft, "id">) => {
    try {
      const item = await api.scheduledItem(scheduledId);
      if (item.status !== "pending") throw new Error(item.status);
      await api.cancelScheduled(scheduledId);
    } catch {
      notify("Too late to undo", "The message was already sent.", "error");
      return;
    }
    // A scheduled mail that was being edited is gone now: it comes back as a new message.
    const reopened: ComposeParams = { ...draft.params, scheduledId: undefined, mode: draft.params.mode === "edit" ? "new" : draft.params.mode };
    const id = drafts.minimize({ ...draft, params: reopened, sendAt: undefined });
    const routeParams = Object.fromEntries(Object.entries({ ...reopened, draft: id }).filter(([, v]) => v !== undefined));
    router.push({ pathname: "/compose", params: routeParams });
  };

  const sendNow = () =>
    act(async (): Promise<Done> => {
      // Send delay: queue it on the server for a few seconds, with Undo meanwhile.
      if (sendDelay > 0) {
        const sendAt = new Date(Date.now() + sendDelay * 1000);
        let scheduledId: string;
        if (mode === "edit" && params.scheduledId) {
          await api.updateScheduled(params.scheduledId, { ...mail(), accountId: from, sendAt });
          scheduledId = params.scheduledId;
        } else {
          scheduledId = (await api.schedule(from, mail(), sendAt)).id;
          markAnswered();
        }
        const draft = snapshot();
        return {
          title: `Sending in ${sendDelay} seconds`,
          description: subject.trim() || undefined,
          options: { duration: sendDelay * 1000, action: { label: "Undo", onPress: () => void undoSend(scheduledId, draft) } },
        };
      }
      if (mode === "edit" && params.scheduledId) {
        await api.updateScheduled(params.scheduledId, { ...mail(), accountId: from });
        const result = await api.sendScheduledNow(params.scheduledId);
        if (result.status !== "sent") throw new Error(result.error ?? "Sending failed");
      } else {
        await api.send(from, mail());
        markAnswered();
      }
      return "Message sent";
    });

  const schedule = (date: Date) => {
    setPickerOpen(false);
    void act(async () => {
      if (mode === "edit" && params.scheduledId) {
        await api.updateScheduled(params.scheduledId, { ...mail(), accountId: from, sendAt: date });
      } else {
        await api.schedule(from, mail(), date);
        markAnswered();
      }
      return `Scheduled for ${formatWhen(date)}`;
    });
  };

  /** Closes, keeping what you wrote in Drafts (when saving drafts is on). */
  const closeCompose = async () => {
    const dirty = edited.current && Boolean(to || subject || text.trim() || attachments.length);
    if (dirty && autoDrafts && mode !== "edit") {
      if (await saveDraft()) {
        if (serverDraft.current || lastSaved.current) notify("Saved to Drafts");
        return close();
      }
      const why = draftError ? ` (${draftError})` : "";
      if (!(await confirm({ title: "Couldn't save the draft", message: `Close anyway? What you wrote will be lost${why}.`, confirmLabel: "Close", destructive: true }))) return;
      return close();
    }
    if (dirty && !(await confirm({ title: "Discard this message?", confirmLabel: "Discard", destructive: true }))) return;
    close();
  };

  /** Throws the message away, including its copy in Drafts. */
  const discard = async () => {
    const dirty = Boolean(to || subject || text.trim() || attachments.length);
    if (dirty && !(await confirm({ title: "Discard this message?", message: "Its copy in Drafts is deleted too.", confirmLabel: "Discard", destructive: true }))) return;
    await dropDraft();
    close();
  };

  const attach = async () => {
    try {
      const files = await pickFiles();
      const total = [...attachments, ...files].reduce((sum, f) => sum + f.size, 0);
      if (total > 20 * 1024 * 1024) {
        notify("Attachments are too large", "Keep them under 20 MB in total.", "error");
        return;
      }
      edited.current = true;
      setAttachments((a) => [...a, ...files]);
    } catch (e) {
      notify("Couldn't attach the file", (e as Error).message, "error");
    }
  };

  const inputClass = "h-11 flex-1 text-[15px] text-foreground font-sans web:outline-none";

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Header
        safeTop
        title={TITLES[mode]}
        subtitle={
          mode === "edit" && sendAt
            ? `Scheduled for ${formatWhen(sendAt)}`
            : draftError
              ? `Draft not saved: ${draftError}`
              : savedAt
                ? `Draft saved ${savedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                : undefined
        }
        left={
          <>
            <IconButton icon={X} label={autoDrafts && mode !== "edit" ? "Close (keeps the draft)" : "Close"} onPress={() => void closeCompose()} />
            <IconButton icon={Minus} label="Minimize" onPress={minimize} disabled={busy || loading} />
          </>
        }
        right={
          <>
            <IconButton icon={Trash2} label="Discard" onPress={() => void discard()} disabled={busy} />
            <IconButton icon={Paperclip} label="Attach files" onPress={() => void attach()} disabled={busy || loading} />
            <IconButton icon={CalendarClock} label={mode === "edit" ? "Reschedule" : "Schedule send"} onPress={() => setPickerOpen(true)} disabled={busy || loading} />
            {mode === "edit" ? (
              <Button
                size="sm"
                variant="outline"
                className="ml-1 rounded-lg"
                disabled={busy || loading}
                onPress={() => sendAt && schedule(sendAt > new Date() ? sendAt : new Date(Date.now() + 60_000))}
              >
                <ButtonText>Save</ButtonText>
              </Button>
            ) : null}
            <Button size="sm" className="ml-1 rounded-lg" disabled={busy || loading} onPress={() => void sendNow()}>
              <Send size={14} color={colors.background} strokeWidth={2} />
              <ButtonText>{busy ? "Sending…" : mode === "edit" ? "Send now" : "Send"}</ButtonText>
            </Button>
          </>
        }
      />

      {loading ? (
        <Loading />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="mx-auto w-full max-w-3xl grow px-4 pb-8" keyboardShouldPersistTaps="handled">
          {accounts.length > 1 ? (
            <Field label="From">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5 py-2">
                {accounts.map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={() => markEdited(setFrom)(a.id)}
                    className={`rounded-full border px-3 py-1 ${a.id === from ? "border-primary bg-primary" : "border-border data-[hover=true]:bg-accent"}`}
                  >
                    <View className="flex-row items-center gap-1.5">
                      <ColorDot color={a.color} />
                      <Text size="sm" className={a.id === from ? "text-primary-foreground" : "text-foreground"}>
                        {a.address}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </Field>
          ) : null}
          <Field label="To">
            <TextInput
              value={to}
              onChangeText={markEdited(setTo)}
              autoFocus={mode === "new" || mode === "forward"}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="name@example.com, …"
              placeholderTextColor={colors.muted}
              className={inputClass}
            />
            {!showCc ? (
              <Pressable onPress={() => setShowCc(true)} className="rounded-md px-2 py-1 data-[hover=true]:bg-accent">
                <Text size="sm" className="text-muted-foreground">
                  Cc Bcc
                </Text>
              </Pressable>
            ) : null}
          </Field>
          {showCc ? (
            <>
              <Field label="Cc">
                <TextInput value={cc} onChangeText={markEdited(setCc)} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" className={inputClass} />
              </Field>
              <Field label="Bcc">
                <TextInput value={bcc} onChangeText={markEdited(setBcc)} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" className={inputClass} />
              </Field>
            </>
          ) : null}
          <Field label="Subject">
            <TextInput value={subject} onChangeText={markEdited(setSubject)} placeholderTextColor={colors.muted} className={`${inputClass} font-medium`} />
          </Field>

          {attachments.length ? (
            <View className="flex-row flex-wrap gap-2 border-b border-border/70 py-3">
              {attachments.map((a, i) => (
                <View key={`${a.filename}-${i}`} className="flex-row items-center gap-2 rounded-lg border border-border py-1 pl-3 pr-1">
                  <Paperclip size={13} color={colors.muted} />
                  <Text size="sm" numberOfLines={1} className="max-w-[180px]">
                    {a.filename}
                  </Text>
                  <Text size="xs" className="text-muted-foreground">
                    {formatSize(a.size)}
                  </Text>
                  <IconButton icon={X} size={14} label={`Remove ${a.filename}`} onPress={() => markEdited(setAttachments)(attachments.filter((_, j) => j !== i))} />
                </View>
              ))}
            </View>
          ) : null}

          <RichEditor
            key={seed.version}
            initialHtml={seed.html}
            initialText={seed.text}
            onChange={(nextHtml, nextText) => {
              if (editorLoaded.current || Platform.OS !== "web") edited.current = true;
              editorLoaded.current = true;
              setHtml(nextHtml);
              setText(nextText);
            }}
            autoFocus={mode === "reply" || mode === "replyAll"}
            placeholder="Write your message…"
            signature={withSignature && signature ? { html: signature, position: signaturePosition } : null}
          />

          {signature ? (
            <View className="gap-2 border-t border-border/70 py-3">
              <View className="flex-row items-center gap-3">
                <Text size="sm" className="flex-1 font-medium">
                  Signature
                </Text>
                <Switch size="sm" value={withSignature} onValueChange={setWithSignature} />
              </View>
              {withSignature && hasQuote(html, text) ? (
                <View className="items-start">
                  <Segmented
                    value={signaturePosition}
                    onChange={setSignaturePosition}
                    options={[
                      { value: "before-quote", label: "Above the quoted text" },
                      { value: "end", label: "At the end" },
                    ]}
                  />
                </View>
              ) : null}
              {/* Web and desktop show it inside the text, where it will go. */}
              {withSignature && Platform.OS !== "web" ? <SignaturePreview html={signature} /> : null}
            </View>
          ) : null}

          <View className="gap-1 border-t border-border/70 py-3">
            <View className="flex-row items-center gap-3">
              <Text size="sm" className="flex-1 font-medium">
                Track opens
              </Text>
              <Switch size="sm" value={tracking} onValueChange={setTrack} />
            </View>
            {tracking ? (
              <Text size="xs" className="text-muted-foreground">
                {serverIsLocal
                  ? "Your server runs on this computer, so recipients can't load the tracking image: opens are only recorded once it's online (e.g. apimail.advoxel.com)."
                  : "Adds a tiny image. Approximate: Apple Mail loads images by itself, and many apps block them."}
              </Text>
            ) : null}
          </View>

          {hasQuote(html, text) ? (
            <View className="items-start border-t border-border/70 py-3">
              <Button size="sm" variant="outline" className="rounded-lg" onPress={removeQuote}>
                <ButtonText>Remove quoted text</ButtonText>
              </Button>
            </View>
          ) : null}
        </ScrollView>
      )}

      <SchedulePicker
        isOpen={pickerOpen}
        initial={sendAt}
        onClose={() => setPickerOpen(false)}
        onPick={schedule}
        confirmLabel={mode === "edit" ? "Reschedule" : "Schedule"}
      />
    </KeyboardAvoidingView>
  );
}
