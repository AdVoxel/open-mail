import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { CalendarClock, Paperclip, Send, X } from "lucide-react-native";
import {
  forwardDraft,
  messageKey,
  replyDraft,
  type OutgoingMail,
} from "@mail-app/api-client";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { Header, IconButton, Loading, useConfirm, useNotify } from "@/src/components/kit";
import { pickFiles, type PickedFile } from "@/src/components/pickFiles";
import { SchedulePicker } from "@/src/components/SchedulePicker";
import { useApi } from "@/src/lib/connection";
import { formatSize, formatWhen } from "@/src/lib/format";
import { useMail } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";

type Mode = "new" | "reply" | "replyAll" | "forward" | "edit";

const TITLES: Record<Mode, string> = {
  new: "New message",
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
  edit: "Edit scheduled message",
};

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
  const params = useLocalSearchParams<{ mode?: Mode; accountId?: string; folder?: string; uid?: string; scheduledId?: string }>();
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
  const [threading, setThreading] = useState<Pick<OutgoingMail, "inReplyTo" | "references">>({});
  const [attachments, setAttachments] = useState<PickedFile[]>([]);
  const [sendAt, setSendAt] = useState<Date | undefined>();
  const [loading, setLoading] = useState(mode !== "new");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!from && accounts[0]) setFrom(accounts[0].id);
  }, [accounts, from]);

  // Prefill for replies, forwards and scheduled edits.
  useEffect(() => {
    let cancelled = false;
    const fill = (mail: Partial<OutgoingMail>) => {
      setTo(mail.to ?? "");
      setCc(mail.cc ?? "");
      setBcc(mail.bcc ?? "");
      setShowCc(Boolean(mail.cc || mail.bcc));
      setSubject(mail.subject ?? "");
      setText(mail.text ?? "");
      setThreading({ inReplyTo: mail.inReplyTo, references: mail.references });
    };
    (async () => {
      try {
        if (mode === "edit" && params.scheduledId) {
          const item = await api.scheduledItem(params.scheduledId);
          if (cancelled) return;
          fill(item);
          setFrom(item.accountId);
          setSendAt(new Date(item.sendAt));
          setAttachments((item.attachments ?? []).map((a) => ({ ...a, size: Math.floor((a.content.length * 3) / 4) })));
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
  }, [api, mode, params.scheduledId, params.accountId, params.folder, params.uid]);

  const mail = (): OutgoingMail => ({
    to: to.trim(),
    cc: cc.trim() || undefined,
    bcc: bcc.trim() || undefined,
    subject: subject.trim(),
    text,
    ...threading,
    attachments: attachments.length ? attachments.map(({ filename, contentType, content }) => ({ filename, contentType, content })) : undefined,
  });

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

  async function act(action: () => Promise<string>) {
    if (!validate()) return;
    setBusy(true);
    try {
      const done = await action();
      notify(done);
      close();
    } catch (e) {
      notify("Not sent", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const sendNow = () =>
    act(async () => {
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

  const discard = async () => {
    const dirty = mode === "new" ? Boolean(to || subject || text.trim() || attachments.length) : false;
    if (dirty && !(await confirm({ title: "Discard this message?", confirmLabel: "Discard", destructive: true }))) return;
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
        subtitle={mode === "edit" && sendAt ? `Scheduled for ${formatWhen(sendAt)}` : undefined}
        left={<IconButton icon={X} label="Discard" onPress={() => void discard()} />}
        right={
          <>
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
                    onPress={() => setFrom(a.id)}
                    className={`rounded-full border px-3 py-1 ${a.id === from ? "border-primary bg-primary" : "border-border data-[hover=true]:bg-accent"}`}
                  >
                    <Text size="sm" className={a.id === from ? "text-primary-foreground" : "text-foreground"}>
                      {a.address}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Field>
          ) : null}
          <Field label="To">
            <TextInput
              value={to}
              onChangeText={setTo}
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
                <TextInput value={cc} onChangeText={setCc} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" className={inputClass} />
              </Field>
              <Field label="Bcc">
                <TextInput value={bcc} onChangeText={setBcc} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" className={inputClass} />
              </Field>
            </>
          ) : null}
          <Field label="Subject">
            <TextInput value={subject} onChangeText={setSubject} placeholderTextColor={colors.muted} className={`${inputClass} font-medium`} />
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
                  <IconButton icon={X} size={14} label={`Remove ${a.filename}`} onPress={() => setAttachments((list) => list.filter((_, j) => j !== i))} />
                </View>
              ))}
            </View>
          ) : null}

          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus={mode === "reply" || mode === "replyAll"}
            placeholder="Write your message…"
            placeholderTextColor={colors.muted}
            textAlignVertical="top"
            className="min-h-[320px] flex-1 py-4 text-[15px] leading-6 text-foreground font-sans web:outline-none"
          />
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
