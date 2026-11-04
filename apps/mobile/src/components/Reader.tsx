import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import {
  Archive,
  ArrowLeft,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  Paperclip,
  Reply,
  ReplyAll,
  Star,
  Trash2,
} from "lucide-react-native";
import { displayName, formatAddress, messageKey, type Address, type MailMessage } from "@mail-app/api-client";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useApi } from "@/src/lib/connection";
import { formatFullDate, formatSize } from "@/src/lib/format";
import { useMail } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";
import { saveFile } from "./download";
import { ErrorBanner, Header, IconButton, Initials, Loading, useConfirm, useNotify } from "./kit";
import { MessageBody } from "./MessageBody";

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
  const { updateMessage, removeMessage, folders } = useMail();
  const [message, setMessage] = useState<MailMessage | null>(null);
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
        setMessage(m);
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

  const markUnread = () => {
    if (!message) return;
    updateMessage(key, { seen: false });
    void run("mark as unread", () => api.setFlags(accountId, folder, uid, { seen: false }), onClosed);
  };

  const move = (target: "archive" | "inbox", label: string) =>
    void run(label.toLowerCase(), () => api.move(accountId, folder, uid, target), () => {
      notify(`${label}d`);
      removeMessage(key);
      onClosed();
    });

  const remove = async () => {
    if (role === "trash" && !(await confirm({ title: "Delete forever?", message: "This message will be permanently deleted.", confirmLabel: "Delete", destructive: true }))) {
      return;
    }
    void run("delete", () => api.remove(accountId, folder, uid), () => {
      notify(role === "trash" ? "Deleted" : "Moved to Trash");
      removeMessage(key);
      onClosed();
    });
  };

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
            <IconButton icon={message.seen ? Mail : MailOpen} label="Mark as unread" onPress={markUnread} disabled={busy} />
            {role === "inbox" ? (
              <IconButton icon={Archive} label="Archive" onPress={() => move("archive", "Archive")} disabled={busy} />
            ) : role === "junk" || role === "trash" || role === "archive" || role === "all" ? (
              <IconButton icon={Inbox} label="Move to Inbox" onPress={() => move("inbox", "Move")} disabled={busy} />
            ) : null}
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

  return (
    <View className="flex-1 bg-background">
      {header}
      <ScrollView contentContainerClassName="mx-auto w-full max-w-3xl gap-5 px-5 pb-16 pt-6">
        <Text selectable className="text-2xl font-semibold leading-tight tracking-tight">
          {message.subject}
        </Text>

        <View className="flex-row gap-3">
          <Initials name={displayName(message.from)} size={40} />
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
          </View>
        </View>

        {message.attachments.some((a) => !a.inline) ? (
          <View className="flex-row flex-wrap gap-2">
            {message.attachments
              .filter((a) => !a.inline)
              .map((a) => (
                <Pressable
                  key={a.index}
                  onPress={() => void download(a.index, a.filename)}
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
          </View>
        ) : null}

        <MessageBody message={message} />

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
      </ScrollView>
    </View>
  );
}
