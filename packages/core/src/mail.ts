import { ImapFlow, type FetchMessageObject, type MessageAddressObject, type MessageStructureObject } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import nodemailer from "nodemailer";
import type { ConfigStore } from "./config.js";
import { refreshGoogleAccessToken, signInWithGoogle, type GoogleClient } from "./google-oauth.js";
import { GMAIL_PRESET, MAIL_PRESETS, type HostConfig } from "./presets.js";
import type {
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
  name: string;
  address: string;
  source: "env" | "app";
  imap: HostConfig;
  smtp: HostConfig;
  authType: AuthType;
  user: string;
  saveSentCopy: boolean;
  secret: () => string; // app password or Google refresh token
}

type Credentials = { user: string; pass: string } | { user: string; accessToken: string };

export interface MailServiceOptions {
  env?: NodeJS.ProcessEnv;
  /** Accounts added through the API. Without it, only .env accounts are available. */
  store?: ConfigStore;
  /** Needed for "Sign in with Google" accounts. */
  google?: GoogleClient;
  /** Close pooled IMAP connections after this long without use. */
  idleTimeoutMs?: number;
}

export interface ListOptions {
  folder?: string;
  limit?: number;
  offset?: number;
  /** Free-text search (Gmail search syntax on Gmail; from/to/subject/body elsewhere). */
  query?: string;
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

// .env accounts (from the first version of the app) keep working alongside API-added ones.
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
            secret: () => pass,
          },
        ]
      : [],
  );
}

export class MailService {
  private envAccounts: Account[];
  private store?: ConfigStore;
  private google?: GoogleClient;
  private idleTimeoutMs: number;
  private accessTokens = new Map<AccountId, { accessToken: string; expiresAt: number }>();
  private connections = new Map<AccountId, Promise<ImapFlow>>();
  private idleTimers = new Map<AccountId, NodeJS.Timeout>();
  private folderCache = new Map<AccountId, { at: number; folders: Folder[] }>();

  constructor({ env = process.env, store, google, idleTimeoutMs = 5 * 60_000 }: MailServiceOptions = {}) {
    this.envAccounts = loadEnvAccounts(env);
    this.store = store;
    this.google = google;
    this.idleTimeoutMs = idleTimeoutMs;
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
      name: a.name ?? "",
      address: a.address,
      source: "app",
      imap: a.imap,
      smtp: a.smtp,
      authType: a.auth.type,
      user: a.auth.user,
      saveSentCopy: a.saveSentCopy ?? false,
      secret: () => store!.secret(a),
    }));
    return [...this.envAccounts, ...appAccounts];
  }

  listAccounts(): AccountInfo[] {
    return this.all().map(({ id, label, name, address, source, authType, saveSentCopy, imap }) => ({
      id,
      label,
      name,
      address,
      source,
      authType,
      saveSentCopy,
      imapHost: imap.host,
    }));
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
      name: input.name?.trim() || undefined,
      address,
      imap: input.imap,
      smtp: input.smtp,
      saveSentCopy: input.saveSentCopy ?? defaultSaveSentCopy(input.imap.host),
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
    if (this.account(id).source !== "app") throw new MailError(409, "Accounts from .env can only be changed in .env");
    this.requireStore().updateAccount(id, update);
    return this.listAccounts().find((a) => a.id === id)!;
  }

  async removeAccount(id: AccountId): Promise<void> {
    if (this.account(id).source !== "app") throw new MailError(409, "Accounts from .env can only be removed in .env");
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
      this.folderCache.set(id, { at: Date.now(), folders });
      return folders;
    } finally {
      this.touch(id);
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
  async listMessages(id: AccountId, { folder = "INBOX", limit = 50, offset = 0, query }: ListOptions = {}): Promise<MessagePage> {
    const fields = { uid: true, envelope: true, flags: true, bodyStructure: true, size: true } as const;
    return this.withFolder(id, folder, async (imap) => {
      const messages: MessageHeader[] = [];
      let total: number;
      if (query?.trim()) {
        const q = query.trim();
        const isGmail = imap.capabilities.has("X-GM-EXT-1");
        const found = await imap.search(
          isGmail ? { gmraw: q } : { or: [{ from: q }, { to: q }, { subject: q }, { body: q }] },
          { uid: true },
        );
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
  async listAllInboxes(limit = 50): Promise<MessagePage> {
    const accounts = this.listAccounts();
    const results = await Promise.allSettled(accounts.map((a) => this.listMessages(a.id, { limit })));
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
        { uid: true, source: true, envelope: true, flags: true, bodyStructure: true, size: true },
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
      html: parsed.html || null,
      attachments: parsed.attachments.map((a, index) => ({
        index,
        filename: a.filename ?? `attachment-${index + 1}`,
        contentType: a.contentType,
        size: a.size,
        inline: a.contentDisposition === "inline" && Boolean(a.contentId),
      })),
    };
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

  // ----------------------------------------------------------------- writes

  async setFlags(
    id: AccountId,
    folder: string,
    uid: number,
    flags: { seen?: boolean; flagged?: boolean; answered?: boolean },
  ): Promise<void> {
    const names = { seen: "\\Seen", flagged: "\\Flagged", answered: "\\Answered" } as const;
    await this.withFolder(id, folder, async (imap) => {
      for (const [key, flag] of Object.entries(names) as [keyof typeof names, string][]) {
        const value = flags[key];
        if (value === true) await imap.messageFlagsAdd(String(uid), [flag], { uid: true });
        if (value === false) await imap.messageFlagsRemove(String(uid), [flag], { uid: true });
      }
    });
    this.folderCache.delete(id); // unread counts changed
  }

  /**
   * Move a message. `target` is a folder path, or one of "inbox", "archive",
   * "trash", "junk" to use the account's special-use folder.
   */
  async moveMessage(id: AccountId, folder: string, uid: number, target: string): Promise<{ destination: string }> {
    const destination = await this.resolveTarget(id, target);
    if (destination === folder) throw new MailError(409, "The message is already in that folder");
    await this.withFolder(id, folder, async (imap) => {
      const moved = await imap.messageMove(String(uid), destination, { uid: true });
      if (!moved) throw new MailError(404, `Message ${uid} not found in ${folder}`);
    });
    this.folderCache.delete(id);
    return { destination };
  }

  /** Move to Trash, or delete permanently when already in Trash (or there is no Trash). */
  async deleteMessage(id: AccountId, folder: string, uid: number): Promise<{ permanent: boolean }> {
    const trash = await this.folderForRole(id, ["trash"]);
    if (trash && trash.path !== folder) {
      await this.moveMessage(id, folder, uid, trash.path);
      return { permanent: false };
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

  async send(accountId: AccountId, mail: OutgoingMail): Promise<SendResult> {
    const account = this.account(accountId);
    // Build the message once so the SMTP copy and the "Sent" copy are identical.
    const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({
      from: account.name ? { name: account.name, address: account.address } : account.address,
      to: mail.to,
      cc: mail.cc || undefined,
      bcc: mail.bcc || undefined,
      subject: mail.subject,
      text: mail.text,
      html: mail.html || undefined,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      attachments: mail.attachments?.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        content: Buffer.from(a.content, "base64"),
      })),
    });
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
    hasAttachments: hasAttachment(msg.bodyStructure),
    size: msg.size ?? 0,
  };
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
