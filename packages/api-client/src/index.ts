// Browser/React Native-safe client for the mail server. Only *types* come from
// @mail-app/core, so none of its Node code ends up in the app bundles.
import type {
  AccountCalendarUpdate,
  AccountId,
  AccountInfo,
  AccountInput,
  AccountUpdate,
  Address,
  CalendarEvent,
  CalendarPage,
  EventInput,
  EventReminder,
  EventsPage,
  Folder,
  InvitationResponse,
  MailLabel,
  MailMessage,
  MessageHeader,
  MessagePage,
  NewMail,
  OutgoingMail,
  ScheduledMail,
  SendResult,
  TrackingSummary,
} from "@mail-app/core/types";

// Presets are plain data, safe to bundle into the apps.
export * from "@mail-app/core/presets";
export { draftToHtml, hasQuote, signatureText, stripQuote } from "@mail-app/core/signature";
export { subjectKey } from "@mail-app/core/subject";
export type * from "@mail-app/core/types";

export interface Capabilities {
  version: string;
  manageAccounts: boolean;
  googleSignIn: boolean;
  /** The server can connect Gmail accounts to Google Calendar. Missing on older servers. */
  googleCalendar?: boolean;
}

export interface GoogleClientStatus {
  configured: boolean;
  /** "environment": set on the server (not changeable here); "app": saved from Settings. */
  source: "environment" | "app" | null;
  clientId: string | null;
}

/** Which calendar (and event) an action is about. */
export interface EventTarget {
  accountId: AccountId;
  calendarId: string;
}

export interface ListParams {
  folder?: string;
  limit?: number;
  offset?: number;
  q?: string;
}

export type MoveTarget = "inbox" | "archive" | "trash" | "junk" | (string & {});

export class MailApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createMailApi(baseUrl: string, token: string) {
  const root = baseUrl.trim().replace(/\/+$/, "");

  async function raw(path: string, init?: { method?: string; body?: unknown; timeoutMs?: number; keepalive?: boolean }): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 60_000);
    try {
      const res = await fetch(`${root}/api${path}`, {
        method: init?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
        // Lets a request finish while the page closes (browsers cap such bodies at 64 KB).
        keepalive: init?.keepalive,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new MailApiError(res.status, data.error ?? `HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      if (err instanceof MailApiError) throw err;
      const aborted = (err as Error).name === "AbortError";
      throw new MailApiError(0, aborted ? `The server at ${root} didn't answer in time` : `Can't reach the server at ${root}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function request<T>(path: string, init?: { method?: string; body?: unknown; timeoutMs?: number; keepalive?: boolean }): Promise<T> {
    return (await (await raw(path, init)).json()) as T;
  }

  const acc = (id: AccountId) => `/accounts/${encodeURIComponent(id)}`;
  const msg = (id: AccountId, folder: string, uid: number, suffix = "") =>
    `${acc(id)}/messages/${uid}${suffix}?folder=${encodeURIComponent(folder)}`;

  return {
    baseUrl: root,
    health: () => request<{ ok: true; version: string; time: string }>("/health", { timeoutMs: 8_000 }),
    capabilities: () => request<Capabilities>("/capabilities", { timeoutMs: 8_000 }),

    // Accounts
    accounts: () => request<AccountInfo[]>("/accounts"),
    testAccount: (input: AccountInput) => request<{ ok: true }>("/accounts/test", { method: "POST", body: input }),
    addAccount: (input: AccountInput) => request<AccountInfo>("/accounts", { method: "POST", body: input }),
    updateAccount: (id: AccountId, update: AccountUpdate) =>
      request<AccountInfo>(acc(id), { method: "PATCH", body: update }),
    removeAccount: (id: AccountId) => request<{ ok: true }>(acc(id), { method: "DELETE" }),
    /** Returns a Google sign-in URL to open in a browser, and a session to poll. */
    startGoogleSignIn: () => request<{ sessionId: string; url: string }>("/accounts/google", { method: "POST", body: {} }),
    googleSignInStatus: (sessionId: string) =>
      request<{ status: "pending" | "done" | "error"; account?: AccountInfo; error?: string }>(
        `/accounts/google/${encodeURIComponent(sessionId)}`,
      ),

    // Folders and messages
    folders: (id: AccountId, fresh = false) => request<Folder[]>(`${acc(id)}/folders${fresh ? "?fresh" : ""}`),
    messages: (id: AccountId, { folder = "INBOX", limit = 50, offset = 0, q }: ListParams = {}) => {
      const query = new URLSearchParams({ folder, limit: String(limit), offset: String(offset) });
      if (q) query.set("q", q);
      return request<MessagePage>(`${acc(id)}/messages?${query}`);
    },
    /** Newest inbox messages across all accounts. */
    allInboxes: (limit = 50) => request<MessagePage>(`/messages?limit=${limit}`),
    /** Newest sent messages across all accounts. */
    allSent: (limit = 50) => request<MessagePage>(`/messages?mailbox=sent&limit=${limit}`),
    message: (id: AccountId, folder: string, uid: number) => request<MailMessage>(msg(id, folder, uid)),
    /** The message's whole conversation, newest first (including your replies from Sent). */
    thread: (id: AccountId, folder: string, uid: number) => request<MessageHeader[]>(msg(id, folder, uid, "/thread")),
    attachment: (id: AccountId, folder: string, uid: number, index: number) =>
      raw(msg(id, folder, uid, `/attachments/${index}`)).then((r) => r.blob()),
    /** Every attachment of the message in one ZIP. */
    attachmentsZip: (id: AccountId, folder: string, uid: number) =>
      raw(msg(id, folder, uid, "/attachments"), { timeoutMs: 180_000 }).then((r) => r.blob()),
    /** `labels`: label id → true to add, false to remove. */
    setFlags: (
      id: AccountId,
      folder: string,
      uid: number,
      flags: { seen?: boolean; flagged?: boolean; answered?: boolean; labels?: Record<string, boolean> },
    ) =>
      request<{ ok: true }>(msg(id, folder, uid), { method: "PATCH", body: flags }),
    move: (id: AccountId, folder: string, uid: number, to: MoveTarget) =>
      request<{ destination: string }>(msg(id, folder, uid, "/move"), { method: "POST", body: { to } }),
    /** Moves to Trash, or deletes for good when already in Trash. */
    remove: (id: AccountId, folder: string, uid: number) =>
      request<{ permanent: boolean }>(msg(id, folder, uid), { method: "DELETE" }),

    // Sending
    send: (id: AccountId, mail: OutgoingMail) =>
      request<{ sent: SendResult }>(`${acc(id)}/send`, { method: "POST", body: mail, timeoutMs: 120_000 }).then((r) => r.sent),

    /**
     * Calls `onMail` for each message that arrives, until `signal` aborts or the
     * connection drops (then it resolves; reconnecting is up to the caller).
     * Needs a fetch with streaming bodies (browsers, Electron).
     */
    async watchNewMail(
      onMail: (mail: NewMail) => void,
      signal: AbortSignal,
      /** Calendar alerts that are due (newer servers). */
      onReminder?: (reminder: EventReminder) => void,
    ): Promise<void> {
      const res = await fetch(`${root}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal });
      if (!res.ok || !res.body) throw new MailApiError(res.status, `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const lines = block.split("\n");
          const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
          const data = lines.filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
          if (event === "mail" && data) onMail(JSON.parse(data) as NewMail);
          if (event === "reminder" && data) onReminder?.(JSON.parse(data) as EventReminder);
        }
      }
    },

    // Google OAuth client
    googleClient: () => request<GoogleClientStatus>("/google-client"),
    /** Google checks the ID and secret before they're saved. */
    saveGoogleClient: (clientId: string, clientSecret: string) =>
      request<GoogleClientStatus>("/google-client", { method: "PUT", body: { clientId, clientSecret } }),
    removeGoogleClient: () => request<GoogleClientStatus>("/google-client", { method: "DELETE" }),

    // Screen lock
    lockStatus: () => request<{ enabled: boolean }>("/lock"),
    setLockPassword: (password: string, currentPassword?: string) =>
      request<{ enabled: true }>("/lock", { method: "PUT", body: { password, currentPassword } }),
    disableLock: (password: string) => request<{ enabled: false }>("/lock", { method: "DELETE", body: { password } }),
    unlock: (password: string) => request<{ ok: true }>("/lock/unlock", { method: "POST", body: { password }, timeoutMs: 45_000 }),
    /** Mails a reset code to the account's own address. */
    requestLockReset: (accountId: AccountId) => request<{ sentTo: string }>("/lock/reset", { method: "POST", body: { accountId }, timeoutMs: 120_000 }),
    confirmLockReset: (code: string, password: string) => request<{ ok: true }>("/lock/reset/confirm", { method: "POST", body: { code, password } }),

    // Calendars
    calendars: () => request<CalendarPage>("/calendars"),
    updateCalendarSettings: (id: AccountId, update: AccountCalendarUpdate) =>
      request<AccountInfo>(`${acc(id)}/calendar`, { method: "PATCH", body: update }),
    /** Returns a Google sign-in URL to open in a browser, and a session to poll with googleSignInStatus. */
    connectGoogleCalendar: (id: AccountId) =>
      request<{ sessionId: string; url: string }>(`${acc(id)}/calendar/google`, { method: "POST", body: {} }),
    disconnectGoogleCalendar: (id: AccountId) => request<AccountInfo>(`${acc(id)}/calendar/google`, { method: "DELETE" }),
    events: (from: Date, to: Date) =>
      request<EventsPage>(`/calendar/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
    createEvent: (target: EventTarget, input: EventInput) =>
      request<CalendarEvent>("/calendar/events", { method: "POST", body: { ...target, ...input } }),
    updateEvent: (target: EventTarget & { eventId: string }, input: EventInput) =>
      request<CalendarEvent>("/calendar/events", { method: "PATCH", body: { ...target, ...input } }),
    /** Answers an invitation; the organizer is told. Repeating iCloud events: the whole series. */
    respondToEvent: (target: EventTarget & { eventId: string }, response: InvitationResponse) =>
      request<{ ok: true }>("/calendar/events/respond", { method: "POST", body: { ...target, response } }),
    deleteEvent: (target: EventTarget & { eventId: string }) =>
      request<{ ok: true }>(`/calendar/events?${new URLSearchParams({ ...target })}`, { method: "DELETE" }),

    /** Opens of tracked mail (all of it, or the given Message-IDs). */
    tracking: (messageIds?: string[]) =>
      request<TrackingSummary[]>(`/tracking${messageIds?.length ? `?${messageIds.map((m) => `messageId=${encodeURIComponent(m)}`).join("&")}` : ""}`),

    // Labels
    labels: () => request<MailLabel[]>("/labels"),
    addLabel: (label: Omit<MailLabel, "id">) => request<MailLabel>("/labels", { method: "POST", body: label }),
    updateLabel: (lid: string, update: Partial<Omit<MailLabel, "id">>) =>
      request<MailLabel>(`/labels/${encodeURIComponent(lid)}`, { method: "PATCH", body: update }),
    removeLabel: (lid: string) => request<{ ok: true }>(`/labels/${encodeURIComponent(lid)}`, { method: "DELETE" }),

    // Drafts (the account's Drafts folder)
    /** Saves a draft; `replace` (the previous copy) is removed. `uid` is null when the server can't tell it. */
    saveDraft: (id: AccountId, mail: OutgoingMail, replace?: { folder: string; uid: number }, options: { keepalive?: boolean } = {}) =>
      request<{ folder: string; uid: number | null }>(`${acc(id)}/drafts`, { method: "POST", body: { ...mail, replace }, keepalive: options.keepalive }),
    discardDraft: (id: AccountId, folder: string, uid: number) =>
      request<{ ok: true }>(`${acc(id)}/drafts/${uid}?folder=${encodeURIComponent(folder)}`, { method: "DELETE" }),

    // Scheduled mail
    scheduled: () => request<ScheduledMail[]>("/scheduled"),
    scheduledItem: (sid: string) => request<ScheduledMail>(`/scheduled/${sid}`),
    schedule: (id: AccountId, mail: OutgoingMail, sendAt: Date) =>
      request<ScheduledMail>("/scheduled", { method: "POST", body: { ...mail, accountId: id, sendAt: sendAt.toISOString() } }),
    updateScheduled: (sid: string, update: Partial<OutgoingMail> & { accountId?: AccountId; sendAt?: Date }) =>
      request<ScheduledMail>(`/scheduled/${sid}`, {
        method: "PATCH",
        body: { ...update, sendAt: update.sendAt?.toISOString() },
      }),
    sendScheduledNow: (sid: string) =>
      request<ScheduledMail>(`/scheduled/${sid}/send`, { method: "POST", body: {}, timeoutMs: 120_000 }),
    cancelScheduled: (sid: string) => request<{ ok: true }>(`/scheduled/${sid}`, { method: "DELETE" }),
  };
}

export type MailApi = ReturnType<typeof createMailApi>;

export function messageKey(h: Pick<MessageHeader, "accountId" | "folder" | "uid">): string {
  return `${h.accountId}:${h.folder}:${h.uid}`;
}

export function formatAddress(a: Address): string {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

export function displayName(a: Address): string {
  return a.name || a.address.split("@")[0] || a.address;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** Prefilled fields for replying to (or replying all to) a message. */
export function replyDraft(message: MailMessage, ownAddress: string, all = false): OutgoingMail {
  const replyTo = message.replyTo.length ? message.replyTo : [message.from];
  const others = all
    ? [...message.to, ...message.cc].filter(
        (a) => a.address.toLowerCase() !== ownAddress.toLowerCase() && !replyTo.some((r) => r.address === a.address),
      )
    : [];
  return {
    to: replyTo.map(formatAddress).join(", "),
    cc: others.map(formatAddress).join(", "),
    subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
    text: `\n\nOn ${new Date(message.date).toLocaleString()}, ${formatAddress(message.from)} wrote:\n${quote(message.text.trim())}`,
    inReplyTo: message.messageId,
    references: message.messageId ? [...message.references, message.messageId] : message.references,
  };
}

/** Prefilled fields for forwarding a message (text only; attachments aren't forwarded). */
export function forwardDraft(message: MailMessage): OutgoingMail {
  return {
    to: "",
    subject: /^fwd?:/i.test(message.subject) ? message.subject : `Fwd: ${message.subject}`,
    text: [
      "",
      "",
      "---------- Forwarded message ----------",
      `From: ${formatAddress(message.from)}`,
      `Date: ${new Date(message.date).toLocaleString()}`,
      `Subject: ${message.subject}`,
      `To: ${message.to.map(formatAddress).join(", ")}`,
      "",
      message.text.trim(),
    ].join("\n"),
  };
}
