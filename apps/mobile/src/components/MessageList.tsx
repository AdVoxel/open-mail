import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Platform, RefreshControl, TextInput, View } from "react-native";
import { router } from "expo-router";
import {
  Archive,
  Check,
  CheckCheck,
  Eye,
  Inbox,
  List,
  ListChecks,
  Mail,
  MailOpen,
  Menu,
  MailDot,
  MessagesSquare,
  Paperclip,
  PenSquare,
  Search,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react-native";
import { displayName, messageKey, type MessageHeader, type TrackingSummary } from "@mail-app/api-client";
import { useApi } from "@/src/lib/connection";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { formatListDate } from "@/src/lib/format";
import { ALL_SENT, groupByConversation, useMail, useMailboxTitle, type Conversation } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";
import { useMessageActions } from "@/src/lib/useMessageActions";
import { ColorDot, EmptyState, ErrorBanner, Header, IconButton, LabelChip, Loading, RefreshButton } from "./kit";
import { OpensPopover } from "./OpensPopover";
import { SwipeRow, useJustSwiped } from "./SwipeRow";
import { Tooltip } from "./Tooltip";

const Row = memo(function Row({
  conversation,
  selected,
  checked,
  selecting,
  accountLabel,
  showRecipients,
  tracked,
  onPress,
  onToggleSelect,
}: {
  conversation: Conversation;
  /** Open in the reader beside the list. */
  selected: boolean;
  /** Ticked for a bulk action. */
  checked: boolean;
  /** Some row is ticked: every row shows its checkbox and a tap ticks instead of opening. */
  selecting: boolean;
  accountLabel?: { label: string; color: string };
  /** Sent mail: name the recipients instead of the sender (you). */
  showRecipients?: boolean;
  /** Open tracking of this sent message, if it was tracked. */
  tracked?: TrackingSummary;
  onPress: (m: MessageHeader) => void;
  onToggleSelect: (c: Conversation) => void;
}) {
  const colors = useColors();
  // react-native-web hovers only the innermost pressable, so pointing at the
  // checkbox un-hovers the row: track both to keep the checkbox showing.
  const [rowHovered, setRowHovered] = useState(false);
  const [boxHovered, setBoxHovered] = useState(false);
  const { labels: allLabels } = useMail();
  const justSwiped = useJustSwiped();
  const { latest: message, count, unread, flagged, answered, hasAttachments } = conversation;
  const labels = allLabels.filter((l) => conversation.labels.includes(l.id));
  const showBox = selecting || checked || rowHovered || boxHovered;
  // Unread rows get a wash of the accent color; selected and ticked rows keep their own highlight.
  const tinted = unread && !selected && !checked;
  return (
    <Pressable
      onPress={() => {
        if (justSwiped()) return;
        if (selecting) onToggleSelect(conversation);
        else onPress(message);
      }}
      onLongPress={() => onToggleSelect(conversation)}
      onHoverIn={() => setRowHovered(true)}
      onHoverOut={() => setRowHovered(false)}
      style={tinted ? { backgroundColor: rowHovered ? colors.unreadHover : colors.unread } : undefined}
      className={`flex-row gap-3 border-b border-border/60 py-3 pl-3 pr-4 ${
        selected || checked ? "bg-accent" : tinted ? "" : "data-[hover=true]:bg-accent/50"
      }`}
    >
      <View className="w-5 items-center pt-0.5">
        {!showBox && unread ? <View style={{ backgroundColor: colors.accent }} className="absolute top-1.5 h-2 w-2 rounded-full" /> : null}
        {/* Always mounted so the pointer can reach it; invisible until hovered or selecting. */}
        <Pressable
          onPress={() => onToggleSelect(conversation)}
          onHoverIn={() => setBoxHovered(true)}
          onHoverOut={() => setBoxHovered(false)}
          disabled={!showBox && Platform.OS !== "web"}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel="Select"
          hitSlop={8}
          style={[
            checked ? { backgroundColor: colors.accent, borderColor: colors.accent } : { borderColor: colors.muted },
            { opacity: showBox ? 1 : 0 },
          ]}
          className="h-[18px] w-[18px] items-center justify-center rounded border-[1.5px]"
        >
          {checked ? <Check size={13} color="#ffffff" strokeWidth={3} /> : null}
        </Pressable>
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className={`shrink text-[15px] ${unread ? "font-semibold" : "text-foreground/80"}`}>
            {showRecipients ? `To: ${message.to.map(displayName).join(", ") || "(no recipient)"}` : displayName(message.from)}
          </Text>
          {count > 1 ? (
            <View className="flex-row items-center gap-0.5" accessibilityLabel={`${count} messages`}>
              <MessagesSquare size={12} color={colors.muted} strokeWidth={2} />
              <Text size="xs" className="text-muted-foreground">
                {count}
              </Text>
            </View>
          ) : null}
          <View className="flex-1" />
          <Text size="xs" className={unread ? "font-medium text-foreground" : "text-muted-foreground"}>
            {formatListDate(message.date)}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <Text size="sm" numberOfLines={1} className={`flex-1 ${unread ? "text-foreground" : "text-muted-foreground"}`}>
            {message.subject}
          </Text>
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
          {answered ? (
            <Tooltip label="You replied to this message">
              <CheckCheck size={14} color={colors.accent} />
            </Tooltip>
          ) : null}
          {hasAttachments ? (
            <Tooltip label="Has attachments">
              <Paperclip size={13} color={colors.muted} />
            </Tooltip>
          ) : null}
          {flagged ? <Star size={13} color={colors.star} fill={colors.star} /> : null}
        </View>
        {labels.length ? (
          <View className="flex-row flex-wrap gap-1 pt-0.5">
            {labels.map((l) => (
              <LabelChip key={l.id} name={l.name} color={l.color} />
            ))}
          </View>
        ) : null}
        {accountLabel ? (
          <View className="flex-row items-center gap-1.5">
            <ColorDot color={accountLabel.color} />
            <Text size="xs" numberOfLines={1} className="text-muted-foreground/80">
              {accountLabel.label}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

/** "Updated 14:32:05", with the date when it isn't today. */
function updatedLabel(at: Date | null): string | null {
  if (!at) return null;
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return at.toDateString() === new Date().toDateString()
    ? `Updated ${time}`
    : `Updated ${at.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

/** The message list pane with its header and search. */
export function MessageList({ onOpen, isWide }: { onOpen: (m: MessageHeader) => void; isWide: boolean }) {
  const {
    list,
    refresh,
    loadMore,
    hasMore,
    mailbox,
    accounts,
    accountsLoaded,
    query,
    setQuery,
    selectedKey,
    groupConversations,
    unreadOnly,
    setUnreadOnly,
    setGroupConversations,
    labels: allLabels,
    folders,
  } = useMail();
  const api = useApi();
  const [trackingById, setTrackingById] = useState<Map<string, TrackingSummary>>(() => new Map());
  const sentView =
    mailbox.accountId === null ? mailbox.folder === ALL_SENT : folders[mailbox.accountId]?.find((f) => f.path === mailbox.folder)?.role === "sent";
  const actions = useMessageActions();
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

  // Unread only: mail read here (opened, swiped) leaves the list too, except the one open in the reader.
  const rows = useMemo(() => {
    const all = groupByConversation(messages, groupConversations);
    return unreadOnly ? all.filter((c) => c.unread || messageKey(c.latest) === selectedKey) : all;
  }, [messages, groupConversations, unreadOnly, selectedKey]);

  // Sent views: opens of tracked messages, refreshed with the list. Older servers: none.
  useEffect(() => {
    if (!sentView) return;
    let cancelled = false;
    api.tracking().then(
      (list) => !cancelled && setTrackingById(new Map(list.map((t) => [t.messageId, t]))),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [api, sentView, list.updatedAt]);
  const trackingOf = (c: Conversation) =>
    sentView ? c.members.map((m) => (m.messageId ? trackingById.get(m.messageId) : undefined)).find(Boolean) : undefined;
  // Swipes act on the whole conversation.
  const toggleRead = useCallback((c: Conversation) => actions.setSeen(c.unread ? c.members : [c.latest], c.unread), [actions]);
  const deleteRow = useCallback((c: Conversation) => actions.remove(c.members), [actions]);

  // Bulk selection: checkboxes on hover (web) or long press (touch).
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [bulkLabels, setBulkLabels] = useState(false);
  const clearSelection = useCallback(() => {
    setChecked(new Set());
    setBulkLabels(false);
  }, []);
  useEffect(clearSelection, [mailbox, query, groupConversations, clearSelection]);
  const toggleSelect = useCallback(
    (c: Conversation) =>
      setChecked((current) => {
        const next = new Set(current);
        const key = messageKey(c.latest);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );
  const checkedRows = rows.filter((c) => checked.has(messageKey(c.latest)));
  const checkedMessages = checkedRows.flatMap((c) => c.members);
  const selecting = checkedRows.length > 0;
  const anyUnread = checkedRows.some((c) => c.unread);
  const canArchive = checkedMessages.every((m) => actions.roleOf(m) === "inbox" || m.folder.toUpperCase() === "INBOX");

  const labels = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, { label: a.label, color: a.color }])), [accounts]);
  const unread = list.messages.filter((m) => !m.seen).length;

  const header = selecting ? (
    <Header
      safeTop={!isWide}
      title={`${checkedRows.length} selected`}
      left={<IconButton icon={X} label="Clear selection" onPress={clearSelection} />}
      right={
        <>
          {checkedRows.length < rows.length ? (
            <IconButton icon={ListChecks} label="Select all" onPress={() => setChecked(new Set(rows.map((c) => messageKey(c.latest))))} />
          ) : null}
          <IconButton
            icon={anyUnread ? MailOpen : Mail}
            label={anyUnread ? "Mark as read" : "Mark as unread"}
            onPress={() => actions.setSeen(anyUnread ? checkedMessages : checkedRows.map((c) => c.latest), anyUnread)}
          />
          {canArchive ? (
            <IconButton icon={Archive} label="Archive" onPress={() => void actions.archive(checkedMessages).then((ok) => ok && clearSelection())} />
          ) : null}
          <IconButton icon={Tag} label="Labels" active={bulkLabels} onPress={() => setBulkLabels((o) => !o)} />
          <IconButton icon={Trash2} label="Delete" onPress={() => void actions.remove(checkedMessages).then((ok) => ok && clearSelection())} />
        </>
      }
    />
  ) : (
    <Header
      safeTop={!isWide}
      title={title}
      subtitle={list.loading && !list.messages.length ? "Loading…" : [unread ? `${unread} unread` : null, updatedLabel(list.updatedAt)].filter(Boolean).join(" · ") || undefined}
      left={!isWide ? <IconButton icon={Menu} label="Mailboxes" onPress={() => router.push("/mailboxes")} /> : undefined}
      right={
        <>
          <IconButton
            icon={MailDot}
            label={unreadOnly ? "Showing unread only: show all mail" : "Unread only"}
            active={unreadOnly}
            color={unreadOnly ? colors.accent : undefined}
            onPress={() => setUnreadOnly(!unreadOnly)}
          />
          <IconButton
            icon={groupConversations ? MessagesSquare : List}
            label={groupConversations ? "Show single messages" : "Group by conversation"}
            active={groupConversations}
            onPress={() => setGroupConversations(!groupConversations)}
          />
          <IconButton icon={Search} label="Search" active={searching} onPress={() => setSearching((s) => !s)} />
          <RefreshButton onPress={refresh} busy={list.loading} />
          {!isWide ? <IconButton icon={PenSquare} label="New message" onPress={() => router.push("/compose")} /> : null}
        </>
      }
    />
  );

  const bulkLabelPanel =
    selecting && bulkLabels ? (
      <View className="gap-2 border-b border-border px-4 py-3">
        {allLabels.length ? (
          <View className="flex-row flex-wrap gap-1.5">
            {allLabels.map((l) => {
              const on = checkedMessages.every((m) => (m.labels ?? []).includes(l.id));
              return <LabelChip key={l.id} name={l.name} color={l.color} on={on} onPress={() => actions.setLabel(checkedMessages, l.id, !on)} />;
            })}
          </View>
        ) : (
          <Text size="sm" className="text-muted-foreground">
            No labels yet. Create them in Settings → Labels.
          </Text>
        )}
      </View>
    ) : null;

  const searchBar = searching && !selecting ? (
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
        data={rows}
        keyExtractor={(c) => messageKey(c.latest)}
        renderItem={({ item }) => (
          <SwipeRow unread={item.unread} onToggleRead={() => toggleRead(item)} onDelete={() => deleteRow(item)}>
            <Row
              conversation={item}
              selected={isWide && messageKey(item.latest) === selectedKey}
              checked={checked.has(messageKey(item.latest))}
              showRecipients={sentView}
              tracked={trackingOf(item)}
              selecting={selecting}
              onToggleSelect={toggleSelect}
              accountLabel={unified && accounts.length > 1 ? labels[item.latest.accountId] : undefined}
              onPress={onOpen}
            />
          </SwipeRow>
        )}
        refreshControl={<RefreshControl refreshing={list.loading && list.messages.length > 0} onRefresh={() => void refresh()} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <>
            {list.error ? <ErrorBanner message={list.error} onRetry={() => void refresh()} /> : null}
            {list.accountErrors.map((e) => (
              <ErrorBanner key={e.accountId} message={`${labels[e.accountId]?.label ?? e.accountId}: ${e.error}`} />
            ))}
          </>
        }
        ListEmptyComponent={
          list.error ? undefined : (
            <EmptyState icon={Inbox} title={query || draft ? "No matches" : unreadOnly ? "No unread mail" : "Nothing here"} message={query ? `No messages match “${query}”.` : undefined} />
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
      {bulkLabelPanel}
      {searchBar}
      {body}
    </View>
  );
}
