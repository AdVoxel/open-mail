// Browser/React Native-safe client for the mail server. Only *types* come from
// @mail-app/core, so none of its Node code ends up in the app bundles.
import type {
  AccountId,
  AccountInfo,
  AccountInput,
  AccountUpdate,
  Address,
  Folder,
  MailMessage,
  MessageHeader,
  MessagePage,
  OutgoingMail,
  ScheduledMail,
  SendResult,
} from "@mail-app/core/types";

// Presets are plain data, safe to bundle into the apps.
export * from "@mail-app/core/presets";
export type * from "@mail-app/core/types";

export interface Capabilities {
  version: string;
  manageAccounts: boolean;
  googleSignIn: boolean;
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

  async function raw(path: string, init?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<Response> {
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

  async function request<T>(path: string, init?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<T> {
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
    message: (id: AccountId, folder: string, uid: number) => request<MailMessage>(msg(id, folder, uid)),
    attachment: (id: AccountId, folder: string, uid: number, index: number) =>
      raw(msg(id, folder, uid, `/attachments/${index}`)).then((r) => r.blob()),
    setFlags: (id: AccountId, folder: string, uid: number, flags: { seen?: boolean; flagged?: boolean; answered?: boolean }) =>
      request<{ ok: true }>(msg(id, folder, uid), { method: "PATCH", body: flags }),
    move: (id: AccountId, folder: string, uid: number, to: MoveTarget) =>
      request<{ destination: string }>(msg(id, folder, uid, "/move"), { method: "POST", body: { to } }),
    /** Moves to Trash, or deletes for good when already in Trash. */
    remove: (id: AccountId, folder: string, uid: number) =>
      request<{ permanent: boolean }>(msg(id, folder, uid), { method: "DELETE" }),

    // Sending
    send: (id: AccountId, mail: OutgoingMail) =>
      request<{ sent: SendResult }>(`${acc(id)}/send`, { method: "POST", body: mail, timeoutMs: 120_000 }).then((r) => r.sent),

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
