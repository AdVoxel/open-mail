import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ArrowLeft, CalendarClock, Pencil, RefreshCw, Send, Trash2 } from "lucide-react-native";
import type { ScheduledMail } from "@mail-app/api-client";
import { Badge, BadgeText } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import { Card, EmptyState, ErrorBanner, Header, IconButton, Loading, SectionTitle, useConfirm, useNotify } from "@/src/components/kit";
import { useApi } from "@/src/lib/connection";
import { formatWhen, useIsWide } from "@/src/lib/format";
import { useMail } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";

function StatusBadge({ item }: { item: ScheduledMail }) {
  const variant = item.status === "failed" ? "destructive" : item.status === "sent" ? "secondary" : "outline";
  const label = item.status === "pending" && item.retryAt ? "retrying" : item.status;
  return (
    <Badge variant={variant} className="rounded-md">
      <BadgeText className="normal-case">{label}</BadgeText>
    </Badge>
  );
}

function Row({
  item,
  accountLabel,
  onChanged,
  last,
}: {
  item: ScheduledMail;
  accountLabel: string;
  onChanged: () => void;
  last: boolean;
}) {
  const api = useApi();
  const notify = useNotify();
  const confirm = useConfirm();
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const editable = item.status === "pending" || item.status === "failed";

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      notify(done);
    } catch (e) {
      notify("Something went wrong", (e as Error).message, "error");
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  const remove = async () => {
    const pending = item.status === "pending";
    const ok = await confirm({
      title: pending ? "Cancel this message?" : "Remove from the list?",
      message: pending ? "It won't be sent." : undefined,
      confirmLabel: pending ? "Cancel message" : "Remove",
      destructive: pending,
    });
    if (ok) void run(() => api.cancelScheduled(item.id), pending ? "Scheduled message cancelled" : "Removed");
  };

  const sendNow = () =>
    void run(async () => {
      const result = await api.sendScheduledNow(item.id);
      if (result.status !== "sent") throw new Error(result.error ?? "Sending failed");
    }, "Message sent");

  return (
    <View className={`gap-1.5 px-4 py-3 ${last ? "" : "border-b border-border/70"}`}>
      <View className="flex-row items-center gap-2">
        <Text numberOfLines={1} className="flex-1 font-medium">
          {item.subject || "(no subject)"}
        </Text>
        <StatusBadge item={item} />
      </View>
      <Text size="sm" numberOfLines={1} className="text-muted-foreground">
        To {item.to}
      </Text>
      <View className="flex-row items-center gap-2">
        <CalendarClock size={13} color={colors.muted} />
        <Text size="xs" className="flex-1 text-muted-foreground">
          {item.status === "sent" && item.sentAt ? `Sent ${formatWhen(new Date(item.sentAt))}` : formatWhen(new Date(item.sendAt))} · from {accountLabel}
        </Text>
        {editable ? (
          <>
            <IconButton icon={Pencil} size={16} label="Edit" disabled={busy} onPress={() => router.push({ pathname: "/compose", params: { mode: "edit", scheduledId: item.id } })} />
            <IconButton icon={Send} size={16} label={item.status === "failed" ? "Retry now" : "Send now"} disabled={busy} onPress={sendNow} />
          </>
        ) : null}
        {item.status !== "sending" ? <IconButton icon={Trash2} size={16} label="Cancel" disabled={busy} onPress={() => void remove()} /> : null}
      </View>
      {item.error ? (
        <Text size="xs" className="text-destructive">
          {item.error}
        </Text>
      ) : null}
    </View>
  );
}

export default function ScheduledScreen() {
  const api = useApi();
  const isWide = useIsWide();
  const { accounts } = useMail();
  const [items, setItems] = useState<ScheduledMail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setItems(await api.scheduled());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [api]);

  // Reload when coming back from editing, and every 15 s while open.
  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), 15_000);
      return () => clearInterval(timer);
    }, [load]),
  );

  const label = (id: string) => accounts.find((a) => a.id === id)?.label ?? "removed account";
  const queued = (items ?? []).filter((i) => i.status !== "sent");
  const sent = (items ?? []).filter((i) => i.status === "sent").reverse();

  return (
    <View className="flex-1 bg-background">
      <Header
        safeTop={!isWide}
        title="Scheduled"
        subtitle={items ? `${queued.length} waiting` : undefined}
        left={!isWide ? <IconButton icon={ArrowLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} /> : undefined}
        right={<IconButton icon={RefreshCw} label="Refresh" onPress={() => void load()} />}
      />
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {items === null ? (
        error ? null : <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Nothing scheduled"
          message="Use the calendar button while composing to send a message later. Your server sends it even when this app is closed."
        />
      ) : (
        <ScrollView
          contentContainerClassName="mx-auto w-full max-w-3xl px-4 pb-12"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}
        >
          {queued.length ? (
            <>
              <SectionTitle>Waiting to send</SectionTitle>
              <Card>
                {queued.map((item, i) => (
                  <Row key={item.id} item={item} accountLabel={label(item.accountId)} onChanged={() => void load()} last={i === queued.length - 1} />
                ))}
              </Card>
            </>
          ) : null}
          {sent.length ? (
            <>
              <SectionTitle>Sent</SectionTitle>
              <Card>
                {sent.map((item, i) => (
                  <Row key={item.id} item={item} accountLabel={label(item.accountId)} onChanged={() => void load()} last={i === sent.length - 1} />
                ))}
              </Card>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
