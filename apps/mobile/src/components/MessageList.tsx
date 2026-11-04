import { memo, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Inbox, Menu, Paperclip, PenSquare, RefreshCw, Search, Star, X } from "lucide-react-native";
import { displayName, messageKey, type MessageHeader } from "@mail-app/api-client";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { formatListDate } from "@/src/lib/format";
import { useMail, useMailboxTitle } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";
import { EmptyState, ErrorBanner, Header, IconButton, Loading } from "./kit";

const Row = memo(function Row({
  message,
  selected,
  accountLabel,
  onPress,
}: {
  message: MessageHeader;
  selected: boolean;
  accountLabel?: string;
  onPress: (m: MessageHeader) => void;
}) {
  const colors = useColors();
  const unread = !message.seen;
  return (
    <Pressable
      onPress={() => onPress(message)}
      className={`flex-row gap-3 border-b border-border/60 py-3 pl-3 pr-4 ${
        selected ? "bg-accent" : "data-[hover=true]:bg-accent/50"
      }`}
    >
      <View className="w-2 items-center pt-1.5">
        {unread ? <View style={{ backgroundColor: colors.accent }} className="h-2 w-2 rounded-full" /> : null}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className={`flex-1 text-[15px] ${unread ? "font-semibold" : "text-foreground/80"}`}>
            {displayName(message.from)}
          </Text>
          <Text size="xs" className={unread ? "font-medium text-foreground" : "text-muted-foreground"}>
            {formatListDate(message.date)}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <Text size="sm" numberOfLines={1} className={`flex-1 ${unread ? "text-foreground" : "text-muted-foreground"}`}>
            {message.subject}
          </Text>
          {message.hasAttachments ? <Paperclip size={13} color={colors.muted} /> : null}
          {message.flagged ? <Star size={13} color={colors.star} fill={colors.star} /> : null}
        </View>
        {accountLabel ? (
          <Text size="xs" numberOfLines={1} className="text-muted-foreground/80">
            {accountLabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

/** The message list pane with its header and search. */
export function MessageList({ onOpen, isWide }: { onOpen: (m: MessageHeader) => void; isWide: boolean }) {
  const { list, refresh, loadMore, hasMore, mailbox, accounts, accountsLoaded, query, setQuery, selectedKey } = useMail();
  const title = useMailboxTitle();
  const colors = useColors();
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState(query);
  const unified = mailbox.accountId === null;

  useEffect(() => setDraft(query), [query]);
  useEffect(() => setSearching(false), [mailbox]);

  // The unified view filters loaded messages locally; single accounts search on the server.
  const messages = useMemo(() => {
    if (!unified || !draft.trim()) return list.messages;
    const q = draft.trim().toLowerCase();
    return list.messages.filter((m) =>
      [m.subject, m.from.name, m.from.address].some((field) => field.toLowerCase().includes(q)),
    );
  }, [unified, draft, list.messages]);

  const labels = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a.label])), [accounts]);
  const unread = list.messages.filter((m) => !m.seen).length;

  const header = (
    <Header
      safeTop={!isWide}
      title={title}
      subtitle={list.loading && !list.messages.length ? "Loading…" : unread ? `${unread} unread` : undefined}
      left={!isWide ? <IconButton icon={Menu} label="Mailboxes" onPress={() => router.push("/mailboxes")} /> : undefined}
      right={
        <>
          <IconButton icon={Search} label="Search" active={searching} onPress={() => setSearching((s) => !s)} />
          <IconButton icon={RefreshCw} label="Refresh" onPress={() => void refresh()} disabled={list.loading} />
          {!isWide ? <IconButton icon={PenSquare} label="New message" onPress={() => router.push("/compose")} /> : null}
        </>
      }
    />
  );

  const searchBar = searching ? (
    <View className="flex-row items-center gap-2 border-b border-border px-4 py-2">
      <Search size={16} color={colors.muted} />
      <TextInput
        autoFocus
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => !unified && setQuery(draft.trim())}
        placeholder={unified ? "Filter loaded messages" : "Search this folder"}
        placeholderTextColor={colors.muted}
        returnKeyType="search"
        className="h-9 flex-1 text-sm text-foreground font-sans web:outline-none"
      />
      {draft ? (
        <IconButton
          icon={X}
          size={16}
          label="Clear search"
          onPress={() => {
            setDraft("");
            setQuery("");
          }}
        />
      ) : null}
    </View>
  ) : null;

  let body;
  if (accountsLoaded && accounts.length === 0) {
    body = (
      <EmptyState
        icon={Inbox}
        title="No accounts yet"
        message="Add a Gmail, iCloud or Zoho account in Settings to start."
        action={
          <Pressable onPress={() => router.navigate("/settings")} className="rounded-lg bg-primary px-4 py-2">
            <Text size="sm" className="font-medium text-primary-foreground">
              Open Settings
            </Text>
          </Pressable>
        }
      />
    );
  } else if (list.loading && list.messages.length === 0) {
    body = <Loading />;
  } else {
    body = (
      <FlatList
        data={messages}
        keyExtractor={messageKey}
        renderItem={({ item }) => (
          <Row
            message={item}
            selected={isWide && messageKey(item) === selectedKey}
            accountLabel={unified && accounts.length > 1 ? labels[item.accountId] : undefined}
            onPress={onOpen}
          />
        )}
        refreshControl={<RefreshControl refreshing={list.loading && list.messages.length > 0} onRefresh={() => void refresh()} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <>
            {list.error ? <ErrorBanner message={list.error} onRetry={() => void refresh()} /> : null}
            {list.accountErrors.map((e) => (
              <ErrorBanner key={e.accountId} message={`${labels[e.accountId] ?? e.accountId}: ${e.error}`} />
            ))}
          </>
        }
        ListEmptyComponent={
          list.error ? undefined : (
            <EmptyState icon={Inbox} title={query || draft ? "No matches" : "Nothing here"} message={query ? `No messages match “${query}”.` : undefined} />
          )
        }
        ListFooterComponent={
          list.loadingMore ? (
            <View className="py-4">
              <ActivityIndicator color={colors.muted} />
            </View>
          ) : hasMore && !list.loading ? (
            <Pressable onPress={loadMore} className="items-center py-4 data-[hover=true]:bg-accent/50">
              <Text size="sm" className="text-muted-foreground">
                Load more
              </Text>
            </Pressable>
          ) : undefined
        }
        contentContainerClassName="grow"
      />
    );
  }

  return (
    <View className="flex-1 bg-background">
      {header}
      {searchBar}
      {body}
    </View>
  );
}
