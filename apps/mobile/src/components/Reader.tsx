import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import {
  Archive,
  ArrowLeft,
  Eye,
  FileArchive,
  FolderInput,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  Paperclip,
  Reply,
  ReplyAll,
  Star,
  Tag,
  Trash2,
} from "lucide-react-native";
import {
  displayName,
  formatAddress,
  messageKey,
  type Address,
  type AttachmentInfo,
  type MailMessage,
  type MessageHeader,
  type TrackingSummary,
} from "@mail-app/api-client";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useApi } from "@/src/lib/connection";
import { formatFullDate, formatListDate, formatSize } from "@/src/lib/format";
import { useMail, useSenderColor } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";
import { useMessageActions } from "@/src/lib/useMessageActions";
import { AttachmentPreview, canPreview } from "./AttachmentPreview";
import { saveFile } from "./download";
import { ErrorBanner, Header, IconButton, Initials, LabelChip, Loading, useConfirm, useNotify } from "./kit";
import { MessageBody } from "./MessageBody";
import { MoveToPanel } from "./MoveToPanel";
import { OpensPopover } from "./OpensPopover";

function AddressLine({ label, list }: { label: string; list: Address[] }) {
  if (!list.length) return null;
  return (
    <Text size="xs" className="text-muted-foreground" numberOfLines={2}>
      <Text size="xs" className="font-medium text-muted-foreground">
        {label}{" "}
      </Text>
      {list.map(formatAddress).join(", ")}
    </Text>
  );
}

/** One message in full: sender, attachments, body and reply buttons. */
function MessageView({ message, onCollapse }: { message: MailMessage; onCollapse?: () => void }) {
  const api = useApi();
  const senderColor = useSenderColor();
  const notify = useNotify();
  const colors = useColors();
  const { accountId, folder, uid } = message;
  const [previewing, setPreviewing] = useState<AttachmentInfo | null>(null);
  const [zipping, setZipping] = useState(false);
  const { folders } = useMail();
  const [tracked, setTracked] = useState<TrackingSummary | null>(null);
  const isSent = folders[accountId]?.find((f) => f.path === folder)?.role === "sent";

  // Your sent message: was it opened (if it was tracked)?
  useEffect(() => {
    if (!isSent || !message.messageId) return;
    let cancelled = false;
    api.tracking([message.messageId]).then(
      (list) => !cancelled && setTracked(list[0] ?? null),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [api, isSent, message.messageId]);
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const files = message.attachments.filter((a) => !a.inline);

  const downloadAll = async () => {
    setZipping(true);
    try {
      const blob = await api.attachmentsZip(accountId, folder, uid);
      const name = `${message.subject.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "attachments"}.zip`;
      if (!(await saveFile(blob, name))) notify("Open this message on the desktop app to download attachments.");
    } catch (e) {
      const message = (e as Error).message;
      notify("Download failed", message === "Not found" ? "The server is out of date: restart it." : message, "error");
    } finally {
      setZipping(false);
    }
  };
  const loadPreview = useCallback(
    () => api.attachment(accountId, folder, uid, previewing?.index ?? 0),
    [api, accountId, folder, uid, previewing],
  );

  const download = async (index: number, filename: string) => {
    try {
      const blob = await api.attachment(accountId, folder, uid, index);
      if (!(await saveFile(blob, filename))) notify("Open this message on the desktop app to download attachments.");
    } catch (e) {
      notify("Download failed", (e as Error).message, "error");
    }
  };

  const compose = (mode: "reply" | "replyAll" | "forward") =>
    router.push({ pathname: "/compose", params: { mode, accountId, folder, uid: String(uid) } });

  return (
    <View className="gap-5">
      <View className="flex-row items-start gap-2">
      <Pressable disabled={!onCollapse} onPress={onCollapse} className="min-w-0 flex-1 flex-row gap-3">
        <Initials name={displayName(message.from)} size={40} color={senderColor(message.from.address)} />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row flex-wrap items-baseline gap-x-2">
            <Text className="font-semibold">{displayName(message.from)}</Text>
            <Text size="sm" className="text-muted-foreground" selectable>
              {message.from.address}
            </Text>
          </View>
          <AddressLine label="To" list={message.to} />
          <AddressLine label="Cc" list={message.cc} />
          <Text size="xs" className="text-muted-foreground">
            {formatFullDate(message.date)}
          </Text>
          {tracked ? (
            <View className="flex-row pt-0.5">
              <OpensPopover tracked={tracked}>
                <View className="flex-row items-center gap-1">
                  <Eye size={12} color={tracked.opens ? colors.accent : colors.muted} />
                  <Text size="xs" style={tracked.opens ? { color: colors.accent } : undefined} className={tracked.opens ? "" : "text-muted-foreground"}>
                    {tracked.opens
                      ? `Opened ${tracked.opens}× · first ${when(tracked.firstOpen!)}${tracked.opens > 1 ? ` · last ${when(tracked.lastOpen!)}` : ""}${tracked.appleProxy ? " · may include Apple Mail loading images by itself" : ""}`
                      : "Tracked · not opened yet"}
                  </Text>
                </View>
              </OpensPopover>
            </View>
          ) : null}
        </View>
      </Pressable>
        {/* The same actions as below the message, without scrolling down to them. */}
        <View className="flex-row items-center">
          <IconButton icon={Reply} label="Reply" onPress={() => compose("reply")} />
          {message.to.length + message.cc.length > 1 ? <IconButton icon={ReplyAll} label="Reply all" onPress={() => compose("replyAll")} /> : null}
          <IconButton icon={Forward} label="Forward" onPress={() => compose("forward")} />
        </View>
      </View>

      {message.attachments.some((a) => !a.inline) ? (
        <View className="flex-row flex-wrap gap-2">
          {message.attachments
            .filter((a) => !a.inline)
            .map((a) => (
              <Pressable
                key={a.index}
                onPress={() => (canPreview(a.contentType) ? setPreviewing(a) : void download(a.index, a.filename))}
                className="max-w-[260px] flex-row items-center gap-2 rounded-lg border border-border px-3 py-2 data-[hover=true]:bg-accent"
              >
                <Paperclip size={14} color={colors.muted} />
                <Text size="sm" numberOfLines={1} className="shrink">
                  {a.filename}
                </Text>
                <Text size="xs" className="text-muted-foreground">
                  {formatSize(a.size)}
                </Text>
              </Pressable>
            ))}
          {files.length > 1 ? (
            <Pressable
              onPress={() => void downloadAll()}
              disabled={zipping}
              accessibilityLabel="Download all attachments as a ZIP"
              className="flex-row items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 data-[hover=true]:bg-accent"
            >
              <FileArchive size={14} color={colors.muted} />
              <Text size="sm">{zipping ? "Preparing zip…" : `Download all (${files.length}) .zip`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <MessageBody message={message} />

      {previewing ? (
        <AttachmentPreview
          attachment={previewing}
          load={loadPreview}
          onDownload={() => void download(previewing.index, previewing.filename)}
          onClose={() => setPreviewing(null)}
        />
      ) : null}

      <View className="flex-row flex-wrap gap-2 pt-2">
        <Button variant="outline" className="rounded-lg" onPress={() => compose("reply")}>
          <Reply size={16} color={colors.foreground} strokeWidth={1.75} />
          <ButtonText>Reply</ButtonText>
        </Button>
        {message.to.length + message.cc.length > 1 ? (
          <Button variant="outline" className="rounded-lg" onPress={() => compose("replyAll")}>
            <ReplyAll size={16} color={colors.foreground} strokeWidth={1.75} />
            <ButtonText>Reply all</ButtonText>
          </Button>
        ) : null}
        <Button variant="outline" className="rounded-lg" onPress={() => compose("forward")}>
          <Forward size={16} color={colors.foreground} strokeWidth={1.75} />
          <ButtonText>Forward</ButtonText>
        </Button>
      </View>
    </View>
  );
}

/** Another message of the conversation: a one-line summary that opens in place. */
function ThreadEntry({ header, tracked }: { header: MessageHeader; tracked?: TrackingSummary }) {
  const api = useApi();
  const senderColor = useSenderColor();
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || message) return;
    let cancelled = false;
    setError(null);
    api.message(header.accountId, header.folder, header.uid).then(
      (m) => !cancelled && setMessage(m),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [api, header, open, message]);

  if (open && message) return <MessageView message={message} onCollapse={() => setOpen(false)} />;

  return (
    <View className="gap-2">
      <Pressable onPress={() => setOpen((o) => !o)} className="-mx-3 flex-row items-center gap-3 rounded-xl px-3 py-3 data-[hover=true]:bg-accent/50">
        <Initials name={displayName(header.from)} size={32} color={senderColor(header.from.address)} />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className={header.seen ? "text-foreground/80" : "font-semibold"}>
            {displayName(header.from)}
          </Text>
          <Text size="xs" numberOfLines={1} className="text-muted-foreground">
            {header.to.length ? `To ${header.to.map(displayName).join(", ")}` : header.from.address}
          </Text>
        </View>
        {tracked ? (
          <OpensPopover tracked={tracked}>
            <View className="flex-row items-center gap-0.5">
              <Eye size={13} color={tracked.opens ? colors.accent : colors.muted} />
              {tracked.opens ? (
                <Text size="xs" style={{ color: colors.accent }}>
                  {tracked.opens}
                </Text>
              ) : null}
            </View>
          </OpensPopover>
        ) : null}
        {header.hasAttachments ? <Paperclip size={13} color={colors.muted} /> : null}
        <Text size="xs" className="text-muted-foreground">
          {formatListDate(header.date)}
        </Text>
      </Pressable>
      {open && error ? <ErrorBanner message={error} /> : null}
      {open && !error ? <Loading /> : null}
    </View>
  );
}

export function Reader({
  accountId,
  folder,
  uid,
  onBack,
  onClosed,
}: {
  accountId: string;
  folder: string;
  uid: number;
  /** Shown as a back arrow on phones. */
  onBack?: () => void;
  /** After the message was archived/deleted/moved. */
  onClosed: () => void;
}) {
  const api = useApi();
  const notify = useNotify();
  const confirm = useConfirm();
  const colors = useColors();
  const { updateMessage, removeMessage, folders, groupConversations, labels } = useMail();
  const [labelPicker, setLabelPicker] = useState(false);
  const [movePicker, setMovePicker] = useState(false);
  const actions = useMessageActions();
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [thread, setThread] = useState<MessageHeader[] | null>(null);
  // Opens of the conversation's tracked messages, by Message-ID, for the collapsed entries.
  const [threadTracking, setThreadTracking] = useState<Map<string, TrackingSummary>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const markedRead = useRef(false);
  const key = messageKey({ accountId, folder, uid });
  const role = folders[accountId]?.find((f) => f.path === folder)?.role;

  useEffect(() => {
    let cancelled = false;
    setMessage(null);
    setError(null);
    markedRead.current = false;
    api.message(accountId, folder, uid).then(
      (m) => {
        if (cancelled) return;
        setMessage({ ...m, labels: m.labels ?? [] }); // older servers send no labels
        if (!m.seen && !markedRead.current) {
          markedRead.current = true;
          updateMessage(key, { seen: true });
          api.setFlags(accountId, folder, uid, { seen: true }).catch(() => updateMessage(key, { seen: false }));
        }
      },
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [api, accountId, folder, uid, key, updateMessage]);

  // The rest of the conversation. With grouping on, opening it marks the whole conversation as read.
  useEffect(() => {
    let cancelled = false;
    setThread(null);
    api.thread(accountId, folder, uid).then(
      (headers) => {
        if (cancelled) return;
        setThread(headers);
        const ids = headers.map((h) => h.messageId).filter((id): id is string => Boolean(id));
        if (ids.length > 1)
          api.tracking(ids).then(
            (list) => !cancelled && setThreadTracking(new Map(list.map((t) => [t.messageId, t]))),
            () => undefined, // older servers: no badges
          );
        if (!groupConversations) return;
        for (const h of headers) {
          const k = messageKey(h);
          if (h.seen || k === key) continue;
          updateMessage(k, { seen: true });
          api.setFlags(h.accountId, h.folder, h.uid, { seen: true }).catch(() => updateMessage(k, { seen: false }));
        }
      },
      // Without the conversation, the message is still shown on its own.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [api, accountId, folder, uid, key, updateMessage, groupConversations]);

  async function run(label: string, action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    try {
      await action();
      after?.();
    } catch (e) {
      notify(`Couldn't ${label}`, (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const toggleFlag = () => {
    if (!message) return;
    const flagged = !message.flagged;
    setMessage({ ...message, flagged });
    updateMessage(key, { flagged });
    void run("update the star", () => api.setFlags(accountId, folder, uid, { flagged }));
  };

  const toggleLabel = (labelId: string) => {
    if (!message) return;
    const on = !message.labels.includes(labelId);
    const next = on ? [...message.labels, labelId] : message.labels.filter((l) => l !== labelId);
    const previous = message.labels;
    setMessage({ ...message, labels: next });
    updateMessage(key, { labels: next });
    api.setFlags(accountId, folder, uid, { labels: { [labelId]: on } }).catch((e: Error) => {
      setMessage((m) => (m ? { ...m, labels: previous } : m));
      updateMessage(key, { labels: previous });
      notify("Couldn't change the label", e.message, "error");
    });
  };

  const markUnread = () => {
    if (!message) return;
    updateMessage(key, { seen: false });
    void run("mark as unread", () => api.setFlags(accountId, folder, uid, { seen: false }), onClosed);
  };

  /** Moves the message (archive, inbox, or a folder's path), then offers Undo. */
  const move = (target: string, done: string) => {
    let result: { destination: string; uid?: number } | undefined;
    void run("move the message", async () => (result = await api.move(accountId, folder, uid, target)), () => {
      actions.offerUndo(done, [{ message: { accountId, folder }, to: result!.destination, uid: result!.uid }]);
      setMovePicker(false);
      removeMessage(key);
      onClosed();
    });
  };

  const remove = async () => {
    if (role === "trash" && !(await confirm({ title: "Delete forever?", message: "This message will be permanently deleted.", confirmLabel: "Delete", destructive: true }))) {
      return;
    }
    let result: Awaited<ReturnType<typeof api.remove>> | undefined;
    void run("delete", async () => (result = await api.remove(accountId, folder, uid)), () => {
      if (result?.trash) actions.offerUndo("Moved to Trash", [{ message: { accountId, folder }, to: result.trash.folder, uid: result.trash.uid }]);
      else notify("Deleted");
      removeMessage(key);
      onClosed();
    });
  };

  const header = (
    <Header
      safeTop={Boolean(onBack)}
      left={onBack ? <IconButton icon={ArrowLeft} label="Back" onPress={onBack} /> : undefined}
      right={
        message ? (
          <>
            <IconButton
              icon={Star}
              label={message.flagged ? "Unstar" : "Star"}
              color={message.flagged ? colors.star : undefined}
              onPress={toggleFlag}
              disabled={busy}
            />
            <IconButton icon={Tag} label="Labels" active={labelPicker} onPress={() => setLabelPicker((o) => !o)} />
            <IconButton icon={message.seen ? Mail : MailOpen} label="Mark as unread" onPress={markUnread} disabled={busy} />
            {role === "inbox" ? (
              <IconButton icon={Archive} label="Archive" onPress={() => move("archive", "Archived")} disabled={busy} />
            ) : role === "junk" || role === "trash" || role === "archive" || role === "all" ? (
              <IconButton icon={Inbox} label="Move to Inbox" onPress={() => move("inbox", "Moved to Inbox")} disabled={busy} />
            ) : null}
            <IconButton
              icon={FolderInput}
              label="Move to"
              active={movePicker}
              onPress={() => {
                setMovePicker((o) => !o);
                setLabelPicker(false);
              }}
              disabled={busy}
            />
            <IconButton icon={Trash2} label={role === "trash" ? "Delete forever" : "Delete"} onPress={() => void remove()} disabled={busy} />
          </>
        ) : undefined
      }
    />
  );

  if (error) {
    return (
      <View className="flex-1 bg-background">
        {header}
        <ErrorBanner message={error} />
      </View>
    );
  }
  if (!message) {
    return (
      <View className="flex-1 bg-background">
        {header}
        <Loading />
      </View>
    );
  }

  // Newest first; the opened message is always part of it.
  const entries: MessageHeader[] = thread?.some((h) => messageKey(h) === key) ? thread : [message];

  return (
    <View className="flex-1 bg-background">
      {header}
      {movePicker ? <MoveToPanel accountId={accountId} current={folder} onPick={(path, name) => move(path, `Moved to ${name}`)} /> : null}
      <ScrollView contentContainerClassName="mx-auto w-full max-w-3xl gap-5 px-5 pb-16 pt-6">
        <View className="gap-1">
          <Text selectable className="text-2xl font-semibold leading-tight tracking-tight">
            {message.subject}
          </Text>
          {entries.length > 1 ? (
            <Text size="sm" className="text-muted-foreground">
              {entries.length} messages, newest first
            </Text>
          ) : null}
          {labelPicker ? (
            <View className="mt-2 gap-2 rounded-xl border border-border p-3">
              {labels.length ? (
                <>
                  <Text size="xs" className="text-muted-foreground">
                    Tap a label to add or remove it.
                  </Text>
                  <View className="flex-row flex-wrap gap-1.5">
                    {labels.map((l) => (
                      <LabelChip key={l.id} name={l.name} color={l.color} on={message.labels.includes(l.id)} onPress={() => toggleLabel(l.id)} />
                    ))}
                  </View>
                </>
              ) : (
                <Text size="sm" className="text-muted-foreground">
                  No labels yet. Create them in{" "}
                  <Text size="sm" className="font-medium text-foreground underline" onPress={() => router.navigate("/settings")}>
                    Settings → Labels
                  </Text>
                  .
                </Text>
              )}
            </View>
          ) : message.labels.some((id) => labels.some((l) => l.id === id)) ? (
            <View className="mt-1 flex-row flex-wrap gap-1.5">
              {labels
                .filter((l) => message.labels.includes(l.id))
                .map((l) => (
                  <LabelChip key={l.id} name={l.name} color={l.color} onPress={() => setLabelPicker(true)} />
                ))}
            </View>
          ) : null}
        </View>

        {entries.map((h, i) => (
          <View key={messageKey(h)} className={i > 0 ? "border-t border-border pt-5" : undefined}>
            {messageKey(h) === key ? <MessageView message={message} /> : <ThreadEntry header={h} tracked={h.messageId ? threadTracking.get(h.messageId) : undefined} />}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
