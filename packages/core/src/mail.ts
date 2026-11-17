import {
  ImapFlow,
  type FetchMessageObject,
  type FetchQueryObject,
  type MessageAddressObject,
  type MessageStructureObject,
  type SearchObject,
} from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import nodemailer from "nodemailer";
import type { ConfigStore, StoredAccount } from "./config.js";
import { refreshGoogleAccessToken, signInWithGoogle, type GoogleClient, type GoogleClientSource } from "./google-oauth.js";
import { GMAIL_PRESET, MAIL_PRESETS, paletteColor, type HostConfig } from "./presets.js";
import { applySignature } from "./signature.js";
import { subjectKey } from "./subject.js";
import { labelKeyword, labelsFromFlags } from "./labels.js";
import { zip } from "./zip.js";
import { TRACKING_PIXEL } from "./tracking.js";
import type {
  AccountCalendar,
  AccountId,
  AccountInfo,
  AccountInput,
  AccountUpdate,
  Address,
  AuthType,
  Folder,
  FolderRole,
  MailMessage,
  MessageHeader,
  MessagePage,
  NewMail,
  OutgoingMail,
  SendResult,
} from "./types.js";

/** Thrown for problems the caller can fix (bad input, missing folder...). Mapped to 4xx by the server. */
export class MailError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Account {
  id: AccountId;
  label: string;
  color?: string;
  signature?: string;
  calendar?: StoredAccount["calendar"];
  name: string;
  address: string;
  source: "env" | "app";
  imap: HostConfig;
  smtp: HostConfig;
  authType: AuthType;
  user: string;
  saveSentCopy: boolean;
  importContacts: boolean;
  secret: () => string; // app password or Google refresh token
}

type Credentials = { user: string; pass: string } | { user: string; accessToken: string };

export interface MailServiceOptions {
  env?: NodeJS.ProcessEnv;
  /** Accounts added through the API. Without it, only environment-variable accounts are available. */
  store?: ConfigStore;
  /** Needed for "Sign in with Google" accounts. A function is asked each time (the client can change while running). */
  google?: GoogleClient | GoogleClientSource;
  /** Close pooled IMAP connections after this long without use. */
  idleTimeoutMs?: number;
}

export interface ListOptions {
  folder?: string;
  limit?: number;
  offset?: number;
  /** Free-text search (Gmail search syntax on Gmail; from/to/subject/body elsewhere). */
  query?: string;
  /** Only unread messages. */
  unread?: boolean;
}

const ROLE_BY_SPECIAL_USE: Record<string, FolderRole> = {
  "\\Inbox": "inbox",
  "\\Sent": "sent",
  "\\Drafts": "drafts",
  "\\Trash": "trash",
  "\\Junk": "junk",
  "\\Archive": "archive",
  "\\All": "all",
  "\\Flagged": "flagged",
};
const ROLE_ORDER: FolderRole[] = ["inbox", "flagged", "drafts", "sent", "archive", "all", "junk", "trash"];
const FOLDER_CACHE_MS = 10 * 60_000;
/** What a message list row needs, including what identifies its conversation. */
const HEADER_FIELDS: FetchQueryObject = {
  uid: true,
  envelope: true,
  flags: true,
  bodyStructure: true,
  size: true,
  threadId: true,
  headers: ["references"],
};
/** Most new messages announced per inbox per check (a flood is summed up by the apps' refresh). */
const NEW_MAIL_LIMIT = 20;
/** Most messages returned for one conversation, per folder searched. */
const THREAD_LIMIT = 100;

// Environment-variable accounts (from the first version of the app) keep working alongside API-added ones.
function loadEnvAccounts(env: NodeJS.ProcessEnv): Account[] {
  const preset = (id: string) => MAIL_PRESETS.find((p) => p.id === id)!;
  const defs = [
    { ...preset("gmail"), user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    { ...preset("icloud"), user: env.ICLOUD_USER, pass: env.ICLOUD_APP_PASSWORD },
    {
      ...preset("zoho"),
      user: env.ZOHO_USER,
      pass: env.ZOHO_APP_PASSWORD,
      imap: { ...preset("zoho").imap, host: env.ZOHO_IMAP_HOST || preset("zoho").imap.host },
      smtp: { ...preset("zoho").smtp, host: env.ZOHO_SMTP_HOST || preset("zoho").smtp.host },
    },
  ];
  return defs.flatMap(({ id, user, pass, label, imap, smtp, saveSentCopy }) =>
    user && pass
      ? [
          {
            id,
            label,
            name: "",
            address: user,
            source: "env" as const,
            imap,
            smtp,
            authType: "password" as const,
            user,
            saveSentCopy,
            importContacts: false, // no account store: no calendar or contacts
            secret: () => pass,
          },
        ]
      : [],
  );
}

export class MailService {
  private envAccounts: Account[];
  private store?: ConfigStore;
  private googleSource: GoogleClientSource;
  private idleTimeoutMs: number;
  private accessTokens = new Map<AccountId, { accessToken: string; expiresAt: number }>();
  private connections = new Map<AccountId, Promise<ImapFlow>>();
  private idleTimers = new Map<AccountId, NodeJS.Timeout>();
  private folderCache = new Map<AccountId, { at: number; folders: Folder[] }>();

  constructor({ env = process.env, store, google, idleTimeoutMs = 5 * 60_000 }: MailServiceOptions = {}) {
    this.envAccounts = loadEnvAccounts(env);
    this.store = store;
    this.googleSource = typeof google === "function" ? google : () => google;
    this.idleTimeoutMs = idleTimeoutMs;
  }

  private get google(): GoogleClient | undefined {
    return this.googleSource();
  }

  get canManageAccounts(): boolean {
    return this.store !== undefined;
  }

  get canSignInWithGoogle(): boolean {
    return this.store !== undefined && this.google !== undefined;
  }

  // ---------------------------------------------------------------- accounts

  private all(): Account[] {
    const store = this.store;
    const appAccounts: Account[] = (store?.accounts() ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      color: a.color,
      signature: a.signature,
      calendar: a.calendar,
      name: a.name ?? "",
      address: a.address,
      source: "app",
      imap: a.imap,
      smtp: a.smtp,
      authType: a.auth.type,
      user: a.auth.user,
      saveSentCopy: a.saveSentCopy ?? false,
      importContacts: a.importContacts ?? true,
      secret: () => store!.secret(a),
    }));
    return [...this.envAccounts, ...appAccounts];
  }

  listAccounts(): AccountInfo[] {
    return this.all().map(({ id, label, color, signature, calendar, name, address, user, source, authType, saveSentCopy, importContacts, imap }) => ({
      id,
      label,
      login: user,
      color: color ?? paletteColor(id),
      signature: signature ?? "",
      calendar: calendarStatus(source, imap.host, calendar),
      name,
      address,
      source,
      authType,
      saveSentCopy,
      importContacts,
      imapHost: imap.host,
    }));
  }

  /** Username and app password, for services that take the same login (iCloud CalDAV). */
  passwordLogin(id: AccountId): { user: string; pass: string } {
    const account = this.account(id);
    if (account.authType !== "password") throw new MailError(409, "This account signs in with Google, not a password");
    return { user: account.user, pass: account.secret() };
  }

  hasAccount(id: AccountId): boolean {
    return this.all().some((a) => a.id === id);
  }

  private account(id: AccountId): Account {
    const account = this.all().find((a) => a.id === id);
    if (!account) throw new MailError(404, `Account "${id}" is not configured`);
    return account;
  }

  private requireStore(): ConfigStore {
    if (!this.store) throw new MailError(501, "This server has no account store");
    return this.store;
  }

  private async credentials(account: Account): Promise<Credentials> {
    if (account.authType === "password") return { user: account.user, pass: account.secret() };
    if (!this.google) throw new MailError(501, "Google sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
    const cached = this.accessTokens.get(account.id);
    if (cached && cached.expiresAt > Date.now() + 60_000) return { user: account.user, accessToken: cached.accessToken };
    const fresh = await refreshGoogleAccessToken(this.google, account.secret());
    this.accessTokens.set(account.id, fresh);
    return { user: account.user, accessToken: fresh.accessToken };
  }

  /** Log in to IMAP and SMTP without saving anything. Throws with the server's error. */
  async testConnection(host: { imap: HostConfig; smtp: HostConfig }, auth: Credentials): Promise<void> {
    const imap = new ImapFlow({ ...host.imap, auth, logger: false });
    imap.on("error", () => {});
    try {
      await imap.connect();
      await imap.logout();
    } catch (err) {
      throw new MailError(400, `IMAP (${host.imap.host}): ${describe(err)}`);
    }
    try {
      await smtpTransport(host.smtp, auth).verify();
    } catch (err) {
      throw new MailError(400, `SMTP (${host.smtp.host}): ${describe(err)}`);
    }
  }

  async addAccount(input: AccountInput): Promise<AccountInfo> {
    const store = this.requireStore();
    const address = input.address.trim();
    const user = input.user?.trim() || address;
    await this.testConnection(input, { user, pass: input.password });
    const stored = store.addAccount({
      label: input.label?.trim() || address,
      color: input.color,
      name: input.name?.trim() || undefined,
      address,
      imap: input.imap,
      smtp: input.smtp,
      saveSentCopy: input.saveSentCopy ?? defaultSaveSentCopy(input.imap.host),
      importContacts: input.importContacts ?? true,
      auth: { type: "password", user, secret: input.password },
    });
    return this.listAccounts().find((a) => a.id === stored.id)!;
  }

  async addGoogleAccount(openUrl: (url: string) => Promise<void> | void): Promise<AccountInfo> {
    const store = this.requireStore();
    if (!this.google) throw new MailError(501, "Google sign-in is not configured");
    const { email, refreshToken } = await signInWithGoogle(this.google, openUrl);
    const { accessToken } = await refreshGoogleAccessToken(this.google, refreshToken);
    await this.testConnection(GMAIL_PRESET, { user: email, accessToken });
    const stored = store.addAccount({
      label: email,
      address: email,
      imap: GMAIL_PRESET.imap,
      smtp: GMAIL_PRESET.smtp,
      saveSentCopy: false,
      auth: { type: "google", user: email, secret: refreshToken },
    });
    return this.listAccounts().find((a) => a.id === stored.id)!;
  }

  updateAccount(id: AccountId, update: AccountUpdate): AccountInfo {
    if (this.account(id).source !== "app") throw new MailError(409, "Accounts from environment variables can only be changed there");
    this.requireStore().updateAccount(id, update);
    return this.listAccounts().find((a) => a.id === id)!;
  }

  async removeAccount(id: AccountId): Promise<void> {
    if (this.account(id).source !== "app") throw new MailError(409, "Accounts from environment variables can only be removed there");
    this.requireStore().removeAccount(id);
    this.accessTokens.delete(id);
    await this.disconnect(id);
  }

  // ------------------------------------------------------- IMAP connections

  /** One pooled IMAP connection per account, reopened when it drops. */
  private async imap(id: AccountId): Promise<ImapFlow> {
    for (;;) {
      const pending = this.connections.get(id);
      if (!pending) break;
      const client = await pending.catch(() => null);
      if (client?.usable) return client;
      if (this.connections.get(id) === pending) {
        this.connections.delete(id);
        break;
      }
    }
    const pending = this.openConnection(id);
    this.connections.set(id, pending);
    pending.catch(() => {
      if (this.connections.get(id) === pending) this.connections.delete(id);
    });
    return pending;
  }

  private async openConnection(id: AccountId): Promise<ImapFlow> {
    const account = this.account(id);
    const client = new ImapFlow({ ...account.imap, auth: await this.credentials(account), logger: false });
    client.on("error", (err: Error) => console.warn(`[imap ${account.address}] ${err.message}`));
    try {
      await client.connect();
    } catch (err) {
      throw new MailError(502, `Can't connect to ${account.imap.host}: ${describe(err)}`);
    }
    return client;
  }

  private touch(id: AccountId): void {
    clearTimeout(this.idleTimers.get(id));
    this.idleTimers.set(
      id,
      setTimeout(() => void this.disconnect(id), this.idleTimeoutMs).unref(),
    );
  }

  private async disconnect(id: AccountId): Promise<void> {
    clearTimeout(this.idleTimers.get(id));
    this.idleTimers.delete(id);
    this.folderCache.delete(id);
    const pending = this.connections.get(id);
    this.connections.delete(id);
    const client = await pending?.catch(() => null);
    await client?.logout().catch(() => client.close());
  }

  /** Close every pooled connection (on shutdown). */
  async close(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((id) => this.disconnect(id)));
  }

  /** Run `fn` with `folder` selected, retrying once if a stale pooled connection dropped. */
  private async withFolder<T>(id: AccountId, folder: string, fn: (imap: ImapFlow) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const imap = await this.imap(id);
      try {
        const lock = await imap.getMailboxLock(folder).catch((err: unknown) => {
          if (!imap.usable) throw err;
          throw new MailError(404, `Folder "${folder}" not found`);
        });
        try {
          return await fn(imap);
        } finally {
          lock.release();
        }
      } catch (err) {
        if (attempt === 0 && !imap.usable) continue;
        throw err;
      } finally {
        this.touch(id);
      }
    }
  }

  // ------------------------------------------------------------------ reads

  async listFolders(id: AccountId, { fresh = false } = {}): Promise<Folder[]> {
    const cached = this.folderCache.get(id);
    if (!fresh && cached && Date.now() - cached.at < FOLDER_CACHE_MS) return cached.folders;
    const imap = await this.imap(id);
    try {
      const list = await imap.list({ statusQuery: { messages: true, unseen: true } });
      const folders: Folder[] = list
        .filter((f) => !f.flags.has("\\Noselect") && !f.flags.has("\\NonExistent"))
        .map((f) => ({
          path: f.path,
          name: f.path.toUpperCase() === "INBOX" ? "Inbox" : f.name,
          role: f.path.toUpperCase() === "INBOX" ? "inbox" : (ROLE_BY_SPECIAL_USE[f.specialUse ?? ""] ?? null),
          total: f.status?.messages ?? null,
          unread: f.status?.unseen ?? null,
        }));
      const rank = (f: Folder) => (f.role ? ROLE_ORDER.indexOf(f.role) : ROLE_ORDER.length);
      folders.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
      if (fresh) await this.recountInbox(id, folders);
      this.folderCache.set(id, { at: Date.now(), folders });
      return folders;
    } finally {
      this.touch(id);
    }
  }

  /**
   * The pooled connection keeps the inbox selected, and servers (Gmail among
   * them) often answer STATUS for the selected folder with old numbers. A fresh
   * count asks the inbox itself: its unread messages, by search.
   */
  private async recountInbox(id: AccountId, folders: Folder[]): Promise<void> {
    const inbox = folders.find((f) => f.role === "inbox");
    if (!inbox) return;
    try {
      await this.withFolder(id, inbox.path, async (imap) => {
        await imap.noop(); // take in what changed since the folder was selected
        const unseen = await imap.search({ seen: false }, { uid: true });
        if (unseen) inbox.unread = unseen.length;
        if (imap.mailbox) inbox.total = imap.mailbox.exists;
      });
    } catch (err) {
      console.warn(`[folders ${id}] couldn't recount the inbox: ${describe(err)}`);
    }
  }

  private async folderForRole(id: AccountId, roles: FolderRole[]): Promise<Folder | undefined> {
    const folders = await this.listFolders(id);
    for (const role of roles) {
      const match = folders.find((f) => f.role === role);
      if (match) return match;
    }
    return undefined;
  }

  /** Newest messages first, `limit` at a time. */
  async listMessages(id: AccountId, { folder = "INBOX", limit = 50, offset = 0, query, unread = false }: ListOptions = {}): Promise<MessagePage> {
    const fields = HEADER_FIELDS;
    return this.withFolder(id, folder, async (imap) => {
      const messages: MessageHeader[] = [];
      let total: number;
      if (query?.trim() || unread) {
        const q = query?.trim() ?? "";
        const isGmail = imap.capabilities.has("X-GM-EXT-1");
        if (unread) await imap.noop(); // see messages that arrived since the folder was selected
        const text = q ? (isGmail ? { gmraw: q } : { or: [{ from: q }, { to: q }, { subject: q }, { body: q }] }) : {};
        const found = await imap.search({ ...text, ...(unread ? { seen: false } : {}) }, { uid: true });
        const uids = (found || []).sort((a, b) => b - a);
        total = uids.length;
        const page = uids.slice(offset, offset + limit);
        if (page.length) {
          for await (const msg of imap.fetch(page.join(","), fields, { uid: true })) messages.push(toHeader(id, folder, msg));
        }
      } else {
        // A pooled connection keeps the folder selected; NOOP makes the server
        // report messages that arrived since, so `exists` is current.
        await imap.noop();
        total = imap.mailbox ? imap.mailbox.exists : 0;
        const end = total - offset;
        if (end >= 1) {
          const start = Math.max(1, end - limit + 1);
          for await (const msg of imap.fetch(`${start}:${end}`, fields)) messages.push(toHeader(id, folder, msg));
        }
      }
      messages.sort((a, b) => b.uid - a.uid);
      return { messages, total };
    });
  }

  /** Newest inbox messages across every account, merged by date. */
  async listAllInboxes(limit = 50, unread = false): Promise<MessagePage> {
    return this.listAll("inbox", limit, unread);
  }

  /** Newest messages of one kind of folder (Inbox or Sent) across every account, merged by date. */
  async listAll(role: "inbox" | "sent", limit = 50, unread = false): Promise<MessagePage> {
    const accounts = this.listAccounts();
    const results = await Promise.allSettled(
      accounts.map(async (a) => {
        if (role === "inbox") return this.listMessages(a.id, { limit, unread });
        const sent = await this.folderForRole(a.id, ["sent"]);
        return sent ? this.listMessages(a.id, { folder: sent.path, limit, unread }) : { messages: [], total: 0 };
      }),
    );
    const page: MessagePage = { messages: [], total: 0, errors: [] };
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        page.messages.push(...r.value.messages);
        page.total += r.value.total;
      } else {
        page.errors!.push({ accountId: accounts[i]!.id, error: describe(r.reason) });
      }
    });
    page.messages.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    page.messages = page.messages.slice(0, limit);
    return page;
  }

  private async fetchSource(id: AccountId, folder: string, uid: number) {
    return this.withFolder(id, folder, async (imap) => {
      const msg = await imap.fetchOne(
        String(uid),
        { ...HEADER_FIELDS, source: true },
        { uid: true },
      );
      if (!msg || !msg.source) throw new MailError(404, `Message ${uid} not found in ${folder}`);
      return msg;
    });
  }

  async getMessage(id: AccountId, folder: string, uid: number): Promise<MailMessage> {
    const msg = await this.fetchSource(id, folder, uid);
    const parsed = await simpleParser(msg.source!);
    const references = parsed.references ?? [];
    return {
      ...toHeader(id, folder, msg),
      messageId: parsed.messageId,
      cc: parsedAddresses(parsed.cc),
      replyTo: parsedAddresses(parsed.replyTo),
      references: Array.isArray(references) ? references : [references],
      text: parsed.text ?? "",
      // Your own tracked mail: showing it here mustn't count as the recipient opening it.
      html: parsed.html ? parsed.html.replace(TRACKING_PIXEL, "") : null,
      attachments: parsed.attachments.map((a, index) => ({
        index,
        filename: a.filename ?? `attachment-${index + 1}`,
        contentType: a.contentType,
        size: a.size,
        inline: a.contentDisposition === "inline" && Boolean(a.contentId),
      })),
    };
  }

  /**
   * Every message in the conversation of `folder`/`uid`, newest first. Looks in
   * that folder first, then All Mail on Gmail, or Inbox and Sent elsewhere, so
   * your own replies are included. A message in several folders appears once,
   * preferring the copy in `folder`.
   */
  async getThread(id: AccountId, folder: string, uid: number): Promise<MessageHeader[]> {
    const { target, gmail, serverThreads } = await this.withFolder(id, folder, async (imap) => {
      const msg = await imap.fetchOne(String(uid), HEADER_FIELDS, { uid: true });
      if (!msg) throw new MailError(404, `Message ${uid} not found in ${folder}`);
      return { target: toHeader(id, folder, msg), gmail: imap.capabilities.has("X-GM-EXT-1"), serverThreads: Boolean(msg.threadId) };
    });
    // Same thread, or same subject (without Re:/Fwd: prefixes): the list groups both ways.
    const threadId = target.threadId;
    const subject = subjectKey(target.subject);
    if (!threadId && !subject) return [target];

    const folders = new Set([folder]);
    const all = gmail ? await this.folderForRole(id, ["all"]) : undefined;
    if (all) folders.add(all.path);
    else {
      folders.add("INBOX");
      const sent = await this.folderForRole(id, ["sent"]);
      if (sent) folders.add(sent.path);
    }

    const searches: SearchObject[] = [];
    if (threadId)
      searches.push(
        serverThreads
          ? { threadId }
          : { or: [{ header: { "message-id": threadId } }, { header: { references: threadId } }, { header: { "in-reply-to": threadId } }] },
      );
    // IMAP subject search is a case-insensitive substring match; the exact key is checked below.
    if (subject) searches.push({ subject });
    const belongs = (h: MessageHeader) => (threadId !== undefined && h.threadId === threadId) || (subject !== "" && subjectKey(h.subject) === subject);

    const found: MessageHeader[] = [target];
    for (const path of folders) {
      try {
        const headers = await this.withFolder(id, path, async (imap) => {
          const matched = new Set<number>();
          for (const criteria of searches) for (const uid of (await imap.search(criteria, { uid: true })) || []) matched.add(uid);
          const uids = [...matched].sort((a, b) => b - a).slice(0, THREAD_LIMIT);
          const out: MessageHeader[] = [];
          if (uids.length) for await (const msg of imap.fetch(uids.join(","), HEADER_FIELDS, { uid: true })) out.push(toHeader(id, path, msg));
          return out;
        });
        found.push(...headers.filter(belongs));
      } catch (err) {
        // The conversation is still worth showing without the other folders.
        if (path === folder) throw err;
        console.warn(`[thread ${id}] couldn't search ${path}: ${describe(err)}`);
      }
    }

    const unique = new Map<string, MessageHeader>();
    for (const h of found) {
      const key = h.messageId ?? `${h.folder}:${h.uid}`;
      if (!unique.has(key)) unique.set(key, h);
    }
    return [...unique.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }

  /**
   * Where the inbox stands, and the messages that arrived after `after`. Without
   * `after` (or when the inbox's UIDVALIDITY changed) it only reports where it
   * stands, so nothing old is taken for new.
   */
  async inboxSince(
    id: AccountId,
    after?: { uidValidity: string; uid: number },
  ): Promise<{ uidValidity: string; uid: number; arrived: NewMail[] }> {
    return this.withFolder(id, "INBOX", async (imap) => {
      await imap.noop(); // a pooled connection learns about new mail this way
      const uidValidity = String(imap.mailbox ? imap.mailbox.uidValidity : "");
      const exists = imap.mailbox ? imap.mailbox.exists : 0;
      const newest = exists ? await imap.fetchOne("*", { uid: true }) : false;
      const last = newest ? newest.uid : 0;
      if (!after || after.uidValidity !== uidValidity || last <= after.uid) return { uidValidity, uid: Math.max(last, after?.uid ?? 0), arrived: [] };

      const arrived: NewMail[] = [];
      const range = `${after.uid + 1}:${last}`;
      for await (const msg of imap.fetch(range, { ...HEADER_FIELDS, source: { maxLength: 32_768 } }, { uid: true })) {
        if (msg.uid <= after.uid) continue;
        arrived.push({ message: toHeader(id, "INBOX", msg), preview: await previewText(msg.source) });
      }
      return { uidValidity, uid: last, arrived: arrived.slice(-NEW_MAIL_LIMIT) };
    });
  }

  async getAttachment(id: AccountId, folder: string, uid: number, index: number) {
    const msg = await this.fetchSource(id, folder, uid);
    const attachment = (await simpleParser(msg.source!)).attachments[index];
    if (!attachment) throw new MailError(404, "Attachment not found");
    return {
      filename: attachment.filename ?? `attachment-${index + 1}`,
      contentType: attachment.contentType,
      content: attachment.content,
    };
  }

  /** Every attachment (not inline images) of a message in one ZIP, named after the subject. */
  async getAttachmentsZip(id: AccountId, folder: string, uid: number) {
    const msg = await this.fetchSource(id, folder, uid);
    const parsed = await simpleParser(msg.source!);
    const files = parsed.attachments.filter((a) => !(a.contentDisposition === "inline" && a.contentId));
    if (!files.length) throw new MailError(404, "This message has no attachments");
    const date = parsed.date ?? new Date();
    const content = zip(files.map((a, i) => ({ name: a.filename ?? `attachment-${i + 1}`, content: a.content, date })));
    const base = (parsed.subject ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "attachments";
    return { filename: `${base}.zip`, contentType: "application/zip", content };
  }

  // ----------------------------------------------------------------- writes

  async setFlags(
    id: AccountId,
    folder: string,
    uid: number,
    flags: { seen?: boolean; flagged?: boolean; answered?: boolean; labels?: Record<string, boolean> },
  ): Promise<void> {
    const names = { seen: "\\Seen", flagged: "\\Flagged", answered: "\\Answered" } as const;
    const add: string[] = [];
    const remove: string[] = [];
    for (const [key, flag] of Object.entries(names) as [keyof typeof names, string][]) {
      if (flags[key] === true) add.push(flag);
      if (flags[key] === false) remove.push(flag);
    }
    for (const [label, on] of Object.entries(flags.labels ?? {})) (on ? add : remove).push(labelKeyword(label));
    await this.withFolder(id, folder, async (imap) => {
      if (add.length) await imap.messageFlagsAdd(String(uid), add, { uid: true });
      if (remove.length) await imap.messageFlagsRemove(String(uid), remove, { uid: true });
    });
    this.folderCache.delete(id); // unread counts changed
  }

  /**
   * Move a message. `target` is a folder path, or one of "inbox", "archive",
   * "trash", "junk" to use the account's special-use folder.
   */
  /**
   * Moves a message. `uid` is its id in the destination (for Undo), when the
   * server says (UIDPLUS) or it can be found again by its Message-ID.
   */
  async moveMessage(id: AccountId, folder: string, uid: number, target: string): Promise<{ destination: string; uid?: number }> {
    const destination = await this.resolveTarget(id, target);
    if (destination === folder) throw new MailError(409, "The message is already in that folder");
    const { newUid, messageId } = await this.withFolder(id, folder, async (imap) => {
      // Without UIDPLUS the server won't say the new id: remember the Message-ID to look it up after.
      const messageId = imap.capabilities.has("UIDPLUS")
        ? undefined
        : ((await imap.fetchOne(String(uid), { envelope: true }, { uid: true })) || undefined)?.envelope?.messageId;
      const moved = await imap.messageMove(String(uid), destination, { uid: true });
      if (!moved) throw new MailError(404, `Message ${uid} not found in ${folder}`);
      return { newUid: moved.uidMap?.get(uid), messageId };
    });
    this.folderCache.delete(id);
    if (newUid !== undefined || !messageId) return { destination, uid: newUid };
    try {
      const found = await this.withFolder(id, destination, (imap) => imap.search({ header: { "message-id": messageId } }, { uid: true }));
      return { destination, uid: found && found.length ? Math.max(...found) : undefined };
    } catch {
      return { destination };
    }
  }

  /** To the account's spam folder (Junk / [Gmail]/Spam). */
  async moveToSpam(id: AccountId, folder: string, uid: number): Promise<{ destination: string; uid?: number }> {
    const junk = await this.folderForRole(id, ["junk"]);
    if (!junk) throw new MailError(409, "This account has no spam folder");
    if (junk.path === folder) throw new MailError(409, "The message is already in the spam folder");
    return this.moveMessage(id, folder, uid, junk.path);
  }

  /** Move to Trash, or delete permanently when already in Trash (or there is no Trash). */
  async deleteMessage(id: AccountId, folder: string, uid: number): Promise<{ permanent: boolean; trash?: { folder: string; uid?: number } }> {
    const trash = await this.folderForRole(id, ["trash"]);
    if (trash && trash.path !== folder) {
      const moved = await this.moveMessage(id, folder, uid, trash.path);
      // Where it went, so the app can offer Undo (move it back).
      return { permanent: false, trash: { folder: moved.destination, uid: moved.uid } };
    }
    await this.withFolder(id, folder, (imap) => imap.messageDelete(String(uid), { uid: true }));
    this.folderCache.delete(id);
    return { permanent: true };
  }

  private async resolveTarget(id: AccountId, target: string): Promise<string> {
    const roles: Record<string, FolderRole[]> = {
      inbox: ["inbox"],
      // Gmail has no \Archive: archiving there means moving to All Mail.
      archive: ["archive", "all"],
      trash: ["trash"],
      junk: ["junk"],
    };
    const wanted = roles[target.toLowerCase()];
    if (!wanted) return target;
    const folder = await this.folderForRole(id, wanted);
    if (!folder) throw new MailError(409, `This account has no ${target} folder`);
    return folder.path;
  }

  /** The message as it goes out (MIME), from an account. */
  private async build(account: Account, mail: OutgoingMail) {
    return nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({
      from: account.name ? { name: account.name, address: account.address } : account.address,
      to: mail.to,
      cc: mail.cc || undefined,
      bcc: mail.bcc || undefined,
      subject: mail.subject,
      text: mail.text,
      html: mail.html || undefined,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      messageId: mail.messageId,
      attachments: mail.attachments?.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        content: Buffer.from(a.content, "base64"),
      })),
    });
  }

  /**
   * Saves what's being written to the account's Drafts folder (visible in the
   * provider's own apps too). `replace` is the previous copy, removed once the
   * new one is in.
   */
  async saveDraft(accountId: AccountId, mail: OutgoingMail, replace?: { folder: string; uid: number }): Promise<{ folder: string; uid: number | null }> {
    const account = this.account(accountId);
    const drafts = await this.folderForRole(accountId, ["drafts"]);
    if (!drafts) throw new MailError(409, "This account has no Drafts folder");
    const raw = (await this.build(account, { ...mail, to: mail.to || "" })).message as Buffer;
    const imap = await this.imap(accountId);
    let uid: number | null = null;
    try {
      const appended = await imap.append(drafts.path, raw, ["\\Draft", "\\Seen"]);
      uid = appended && typeof appended === "object" && appended.uid ? appended.uid : null;
    } finally {
      this.touch(accountId);
    }
    if (replace && !(replace.folder === drafts.path && replace.uid === uid)) {
      await this.discardDraft(accountId, replace.folder, replace.uid).catch(() => undefined);
    }
    this.folderCache.delete(accountId);
    return { folder: drafts.path, uid };
  }

  /** Removes a draft for good (no copy in Trash). */
  async discardDraft(accountId: AccountId, folder: string, uid: number): Promise<void> {
    await this.withFolder(accountId, folder, (imap) => imap.messageDelete(String(uid), { uid: true }));
    this.folderCache.delete(accountId);
  }

  async send(accountId: AccountId, outgoing: OutgoingMail): Promise<SendResult> {
    const account = this.account(accountId);
    const mail = outgoing.signature ? applySignature(outgoing, account.signature ?? "", outgoing.signaturePosition) : outgoing;
    // Build the message once so the SMTP copy and the "Sent" copy are identical.
    const built = await this.build(account, mail);
    const raw = built.message as Buffer;
    try {
      await smtpTransport(account.smtp, await this.credentials(account)).sendMail({ envelope: built.envelope, raw });
    } catch (err) {
      throw new MailError(502, `SMTP (${account.smtp.host}): ${describe(err)}`);
    }
    if (account.saveSentCopy) {
      try {
        const sent = await this.folderForRole(accountId, ["sent"]);
        if (sent) {
          const imap = await this.imap(accountId);
          await imap.append(sent.path, raw, ["\\Seen"]);
          this.touch(accountId);
        }
      } catch (err) {
        console.warn(`[send ${account.address}] sent, but couldn't save a copy to Sent: ${describe(err)}`);
      }
    }
    return { messageId: built.messageId };
  }
}

function calendarStatus(source: "env" | "app", imapHost: string, stored: StoredAccount["calendar"]): AccountCalendar {
  // Settings live in the account store, which accounts from environment variables don't have.
  const provider = source === "app" ? (MAIL_PRESETS.find((p) => p.imap.host === imapHost)?.calendar ?? null) : null;
  const connected = provider === "icloud" || (provider === "google" && Boolean(stored?.googleSecret));
  return { provider, enabled: connected && Boolean(stored?.enabled), connected, hidden: stored?.hidden ?? [] };
}

function defaultSaveSentCopy(imapHost: string): boolean {
  return MAIL_PRESETS.find((p) => p.imap.host === imapHost)?.saveSentCopy ?? false;
}

function smtpTransport(host: HostConfig, auth: Credentials) {
  return nodemailer.createTransport({
    ...host,
    auth: "accessToken" in auth ? { type: "OAuth2", user: auth.user, accessToken: auth.accessToken } : auth,
  });
}

function toAddress(a: MessageAddressObject | undefined): Address {
  return { name: a?.name ?? "", address: a?.address ?? "" };
}

function hasAttachment(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  if (node.disposition === "attachment") return true;
  return (node.childNodes ?? []).some(hasAttachment);
}

function toHeader(accountId: AccountId, folder: string, msg: FetchMessageObject): MessageHeader {
  const env = msg.envelope;
  return {
    accountId,
    folder,
    uid: msg.uid,
    messageId: env?.messageId,
    from: toAddress(env?.from?.[0]),
    to: (env?.to ?? []).map(toAddress),
    subject: env?.subject || "(no subject)",
    date: new Date(env?.date ?? msg.internalDate ?? 0).toISOString(),
    seen: msg.flags?.has("\\Seen") ?? false,
    flagged: msg.flags?.has("\\Flagged") ?? false,
    answered: msg.flags?.has("\\Answered") ?? false,
    labels: labelsFromFlags(msg.flags),
    hasAttachments: hasAttachment(msg.bodyStructure),
    size: msg.size ?? 0,
    threadId: conversationId(msg),
  };
}

/** The first words of a message's text (from its possibly truncated source). */
async function previewText(source: Buffer | undefined): Promise<string> {
  if (!source) return "";
  try {
    const parsed = await simpleParser(source);
    const text = parsed.text || (parsed.html ? parsed.html.replace(/<style[\s\S]*?<\/style>|<[^>]+>/gi, " ") : "");
    const words = text.replace(/\s+/g, " ").trim();
    return words.length > 140 ? `${words.slice(0, 139).trimEnd()}…` : words;
  } catch {
    return "";
  }
}

/** `<id@host>` tokens in a header value. */
function messageIds(value: string | undefined): string[] {
  return value?.match(/<[^<>\s]+>/g) ?? [];
}

/** The server's thread id, else the conversation's first Message-ID (see MessageHeader.threadId). */
function conversationId(msg: FetchMessageObject): string | undefined {
  if (msg.threadId) return msg.threadId;
  const env = msg.envelope;
  return messageIds(msg.headers?.toString())[0] ?? messageIds(env?.inReplyTo)[0] ?? messageIds(env?.messageId)[0];
}

function parsedAddresses(value: AddressObject | AddressObject[] | undefined): Address[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((group) =>
    group.value.map((a) => ({ name: a.name ?? "", address: a.address ?? "" })),
  );
}

export function describe(err: unknown): string {
  if (err instanceof Error) {
    const extra = (err as { responseText?: string }).responseText;
    return extra && !err.message.includes(extra) ? `${err.message} (${extra})` : err.message;
  }
  return String(err);
}
