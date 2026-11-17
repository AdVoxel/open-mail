import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { messageKey, paletteColor, subjectKey, type AccountInfo, type Folder, type MailLabel, type MessageHeader } from "@mail-app/api-client";
import { useApi } from "./connection";
import { loadJson, saveJson } from "./storage";

/** Folder of the unified view of every account's Sent folder (`accountId: null`). */
export const ALL_SENT = "SENT";

/** `accountId: null` is a unified view: "All inboxes" (folder INBOX) or "All sent" (folder ALL_SENT). */
export interface Mailbox {
  accountId: string | null;
  folder: string;
}

interface ListState {
  messages: MessageHeader[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** Accounts that failed in the unified view. */
  accountErrors: { accountId: string; error: string }[];
  /** When the list last refreshed successfully. */
  updatedAt: Date | null;
}

interface MailState {
  accounts: AccountInfo[];
  accountsLoaded: boolean;
  reloadAccounts: () => Promise<void>;
  folders: Record<string, Folder[]>;
  loadFolders: (accountId: string, fresh?: boolean) => Promise<void>;
  mailbox: Mailbox;
  setMailbox: (mailbox: Mailbox) => void;
  query: string;
  setQuery: (query: string) => void;
  list: ListState;
  refresh: () => Promise<void>;
  /** The Refresh button: the list, every account's folder counts, and the unread badge, all asked fresh. */
  refreshAll: () => Promise<void>;
  /** Goes up on each refreshAll, so the badge can count again. */
  refreshTick: number;
  loadMore: () => void;
  hasMore: boolean;
  updateMessage: (key: string, patch: Partial<MessageHeader>) => void;
  removeMessage: (key: string) => void;
  selectedKey: string | null;
  setSelectedKey: (key: string | null) => void;
  /** Labels the user defined, to put on messages. */
  labels: MailLabel[];
  reloadLabels: () => Promise<void>;
  /** Show one list row per conversation instead of one per message. */
  groupConversations: boolean;
  setGroupConversations: (on: boolean) => void;
  /** Hide read mail: the list shows unread messages only. */
  unreadOnly: boolean;
  setUnreadOnly: (on: boolean) => void;
  /** How often to check for new mail, in seconds. */
  checkInterval: CheckInterval;
  setCheckInterval: (seconds: CheckInterval) => void;
}

/** Choices for how often to check for new mail, in seconds. */
export const CHECK_INTERVALS = [30, 60, 120, 300, 900, 1800] as const;
export type CheckInterval = (typeof CHECK_INTERVALS)[number];

const PAGE = 50;
const GROUP_KEY = "mail.groupConversations";
const UNREAD_KEY = "mail.unreadOnly";
const INTERVAL_KEY = "mail.checkInterval";
const EMPTY: ListState = { messages: [], total: 0, loading: true, loadingMore: false, error: null, accountErrors: [], updatedAt: null };
const Context = createContext<MailState | null>(null);

export function MailProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [folders, setFolders] = useState<Record<string, Folder[]>>({});
  const [mailbox, setMailboxState] = useState<Mailbox>({ accountId: null, folder: "INBOX" });
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ListState>(EMPTY);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [groupConversations, setGroupState] = useState(true);
  const [unreadOnly, setUnreadState] = useState(false);
  const [checkInterval, setIntervalState] = useState<CheckInterval>(60);
  const [labels, setLabels] = useState<MailLabel[]>([]);
  const requestId = useRef(0);
  const loaded = useRef(0); // how many messages are currently loaded, for refresh
  const [refreshTick, setRefreshTick] = useState(0);

  const reloadAccounts = useCallback(async () => {
    // Servers from before account colors and signatures don't send those fields.
    const next = (await api.accounts()).map((a) => ({
      ...a,
      color: a.color ?? paletteColor(a.id),
      signature: a.signature ?? "",
      login: a.login ?? a.address,
      calendar: a.calendar ?? { provider: null, enabled: false, connected: false, hidden: [] },
    }));
    setAccounts(next);
    setAccountsLoaded(true);
    setMailboxState((m) => {
      // A single account has no "All inboxes" view: show its inbox.
      if (next.length === 1 && m.accountId !== next[0]!.id) return { accountId: next[0]!.id, folder: "INBOX" };
      if (m.accountId && !next.some((a) => a.id === m.accountId)) return { accountId: null, folder: "INBOX" };
      return m;
    });
  }, [api]);

  const reloadLabels = useCallback(async () => {
    try {
      setLabels(await api.labels());
    } catch {
      // Older servers have no labels.
      setLabels([]);
    }
  }, [api]);

  useEffect(() => {
    void reloadLabels();
  }, [reloadLabels]);

  const loadFolders = useCallback(
    async (accountId: string, fresh = false) => {
      try {
        const list = await api.folders(accountId, fresh);
        setFolders((f) => ({ ...f, [accountId]: list }));
      } catch {
        // The sidebar just shows no folders; the message list reports connection errors.
      }
    },
    [api],
  );

  const fetchPage = useCallback(
    async (offset: number, limit: number) => {
      if (mailbox.accountId === null) {
        const count = Math.min(offset + limit, 200);
        return mailbox.folder === ALL_SENT ? api.allSent(count, unreadOnly) : api.allInboxes(count, unreadOnly);
      }
      return api.messages(mailbox.accountId, { folder: mailbox.folder, offset, limit, q: query || undefined, unread: unreadOnly });
    },
    [api, mailbox, query, unreadOnly],
  );

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setList((l) => ({ ...l, loading: true, error: null }));
    try {
      const page = await fetchPage(0, Math.min(Math.max(PAGE, loaded.current), 200));
      if (id !== requestId.current) return;
      loaded.current = page.messages.length;
      setList({
        messages: page.messages,
        total: page.total,
        loading: false,
        loadingMore: false,
        error: null,
        accountErrors: page.errors ?? [],
        updatedAt: new Date(),
      });
    } catch (e) {
      if (id !== requestId.current) return;
      setList((l) => ({ ...l, loading: false, error: (e as Error).message }));
    }
    if (mailbox.accountId) void loadFolders(mailbox.accountId, true);
  }, [fetchPage, loadFolders, mailbox.accountId]);

  const refreshAll = useCallback(async () => {
    setRefreshTick((t) => t + 1);
    await Promise.all([refresh(), ...accounts.map((a) => loadFolders(a.id, true))]);
  }, [refresh, accounts, loadFolders]);

  // New mailbox or search: start from an empty list.
  useEffect(() => {
    loaded.current = 0;
    setList(EMPTY);
    setSelectedKey(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailbox, query, api, unreadOnly]);

  // Keep the list fresh while the app is in the foreground.
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, checkInterval * 1000);
    return () => clearInterval(timer);
  }, [refresh, checkInterval]);

  useEffect(() => {
    void reloadAccounts().catch(() => setAccountsLoaded(true));
  }, [reloadAccounts]);

  const hasMore = list.messages.length < list.total && !(mailbox.accountId === null && list.messages.length >= 200);

  const loadMore = useCallback(() => {
    if (!hasMore || list.loading || list.loadingMore) return;
    const id = requestId.current;
    setList((l) => ({ ...l, loadingMore: true }));
    const unified = mailbox.accountId === null;
    fetchPage(unified ? 0 : list.messages.length, unified ? list.messages.length + PAGE : PAGE)
      .then((page) => {
        if (id !== requestId.current) return;
        setList((l) => {
          const seen = new Set(l.messages.map(messageKey));
          const messages = unified ? page.messages : [...l.messages, ...page.messages.filter((m) => !seen.has(messageKey(m)))];
          loaded.current = messages.length;
          return { ...l, messages, total: page.total, loadingMore: false };
        });
      })
      .catch((e: Error) => setList((l) => ({ ...l, loadingMore: false, error: e.message })));
  }, [fetchPage, hasMore, list.loading, list.loadingMore, list.messages.length, mailbox.accountId]);

  const updateMessage = useCallback((key: string, patch: Partial<MessageHeader>) => {
    setList((l) => ({ ...l, messages: l.messages.map((m) => (messageKey(m) === key ? { ...m, ...patch } : m)) }));
  }, []);

  const removeMessage = useCallback((key: string) => {
    setList((l) => ({ ...l, total: Math.max(0, l.total - 1), messages: l.messages.filter((m) => messageKey(m) !== key) }));
    setSelectedKey((k) => (k === key ? null : k));
  }, []);

  useEffect(() => {
    void loadJson<boolean>(GROUP_KEY).then((saved) => saved !== null && setGroupState(saved));
    void loadJson<boolean>(UNREAD_KEY).then((saved) => saved !== null && setUnreadState(saved));
    void loadJson<number>(INTERVAL_KEY).then(
      (saved) => saved !== null && (CHECK_INTERVALS as readonly number[]).includes(saved) && setIntervalState(saved as CheckInterval),
    );
  }, []);

  const setCheckInterval = useCallback((seconds: CheckInterval) => {
    setIntervalState(seconds);
    void saveJson(INTERVAL_KEY, seconds);
  }, []);

  const setUnreadOnly = useCallback((on: boolean) => {
    setUnreadState(on);
    void saveJson(UNREAD_KEY, on);
  }, []);

  const setGroupConversations = useCallback((on: boolean) => {
    setGroupState(on);
    void saveJson(GROUP_KEY, on);
  }, []);

  const setMailbox = useCallback((next: Mailbox) => {
    setQuery("");
    setMailboxState((m) => (m.accountId === next.accountId && m.folder === next.folder ? m : next));
  }, []);

  const value = useMemo(
    () => ({
      accounts,
      accountsLoaded,
      reloadAccounts,
      folders,
      loadFolders,
      mailbox,
      setMailbox,
      query,
      setQuery,
      list,
      refresh,
      refreshAll,
      refreshTick,
      loadMore,
      hasMore,
      updateMessage,
      removeMessage,
      selectedKey,
      setSelectedKey,
      groupConversations,
      setGroupConversations,
      unreadOnly,
      setUnreadOnly,
      checkInterval,
      setCheckInterval,
      labels,
      reloadLabels,
    }),
    [
      accounts,
      accountsLoaded,
      reloadAccounts,
      folders,
      loadFolders,
      mailbox,
      setMailbox,
      query,
      list,
      refresh,
      refreshAll,
      refreshTick,
      loadMore,
      hasMore,
      updateMessage,
      removeMessage,
      selectedKey,
      groupConversations,
      setGroupConversations,
      unreadOnly,
      setUnreadOnly,
      checkInterval,
      setCheckInterval,
      labels,
      reloadLabels,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMail(): MailState {
  const value = useContext(Context);
  if (!value) throw new Error("useMail must be used inside MailProvider");
  return value;
}

/** Human title for the current mailbox. */
export function useMailboxTitle(): string {
  const { mailbox, accounts, folders } = useMail();
  if (mailbox.accountId === null) return mailbox.folder === ALL_SENT ? "All sent" : "All inboxes";
  const folder = folders[mailbox.accountId]?.find((f) => f.path === mailbox.folder);
  const name = folder?.name ?? (mailbox.folder === "INBOX" ? "Inbox" : mailbox.folder);
  if (accounts.length <= 1) return name;
  const account = accounts.find((a) => a.id === mailbox.accountId);
  return account ? `${name} · ${account.label}` : name;
}

/** A list row: the newest message of a conversation, or a single message when not grouping. */
export interface Conversation {
  latest: MessageHeader;
  /** The conversation's messages in the list, newest first. */
  members: MessageHeader[];
  count: number;
  /** Labels on any message of the conversation. */
  labels: string[];
  unread: boolean;
  flagged: boolean;
  /** You replied to the conversation's latest message (an older reply doesn't count once newer mail came in). */
  answered: boolean;
  hasAttachments: boolean;
}

/** Groups messages by conversation, most recent conversation first. */
export function groupByConversation(messages: MessageHeader[], group: boolean): Conversation[] {
  const single = (m: MessageHeader): Conversation => ({
    latest: m,
    members: [m],
    count: 1,
    labels: m.labels ?? [],
    unread: !m.seen,
    flagged: m.flagged,
    answered: m.answered,
    hasAttachments: m.hasAttachments,
  });
  if (!group) return messages.map(single);

  // Messages belong together when they share a thread id or a subject (without
  // Re:/Fwd: prefixes). Union-find over those keys, so links chain across both.
  const parent = new Map<string, string>();
  const root = (k: string): string => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    for (let n = k; n !== r; ) {
      const next = parent.get(n)!;
      parent.set(n, r);
      n = next;
    }
    return r;
  };
  const keysOf = (m: MessageHeader): string[] => {
    const keys = [m.threadId ? `t:${m.accountId}:${m.threadId}` : `m:${messageKey(m)}`];
    const subject = subjectKey(m.subject);
    if (subject) keys.push(`s:${m.accountId}:${subject}`);
    return keys;
  };
  for (const m of messages) {
    const [first, ...rest] = keysOf(m).map(root);
    parent.set(first, first);
    for (const k of rest) parent.set(k, first);
  }

  const byThread = new Map<string, Conversation>();
  for (const m of messages) {
    const id = root(keysOf(m)[0]);
    const c = byThread.get(id);
    if (!c) {
      byThread.set(id, single(m));
      continue;
    }
    c.count++;
    c.members.push(m);
    c.unread ||= !m.seen;
    c.flagged ||= m.flagged;
    c.hasAttachments ||= m.hasAttachments;
    for (const l of m.labels ?? []) if (!c.labels.includes(l)) c.labels.push(l);
    if (Date.parse(m.date) > Date.parse(c.latest.date)) c.latest = m;
  }
  for (const c of byThread.values()) c.answered = c.latest.answered;
  return [...byThread.values()].sort((a, b) => Date.parse(b.latest.date) - Date.parse(a.latest.date));
}

/**
 * Color for a person's avatar: always the same for the same address. Mail from
 * one of your accounts uses that account's color.
 */
export function useSenderColor(): (address: string) => string {
  const { accounts } = useMail();
  return useCallback(
    (address: string) => accounts.find((a) => a.address.toLowerCase() === address.toLowerCase())?.color ?? paletteColor(address),
    [accounts],
  );
}
