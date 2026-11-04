import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import nodemailer from "nodemailer";
import type { Email } from "./client.js";
import type { AuthType, ConfigStore } from "./config.js";
import { refreshGoogleAccessToken, signInWithGoogle, type GoogleClient } from "./google-oauth.js";
import { GMAIL_PRESET, MAIL_PRESETS, type HostConfig } from "./presets.js";

export type AccountId = string;

interface Account {
  id: AccountId;
  label: string;
  address: string;
  source: "env" | "app";
  imap: HostConfig;
  smtp: HostConfig;
  authType: AuthType;
  user: string;
  secret: () => string; // app password or Google refresh token
}

export interface AccountInfo {
  id: AccountId;
  label: string;
  address: string;
  /** "env" accounts come from .env and can't be removed in the app. */
  source: "env" | "app";
  authType: AuthType;
}

/** A password-based account from the Add Account form (custom servers or a preset). */
export interface AccountInput {
  label?: string;
  address: string;
  user?: string; // defaults to the address
  password: string;
  imap: HostConfig;
  smtp: HostConfig;
}

export interface MessageHeader {
  accountId: AccountId;
  uid: number;
  from: string;
  subject: string;
  date: string;
  seen: boolean;
}

export interface MailMessage extends Email {
  accountId: AccountId;
  uid: number;
  messageId?: string;
  references: string[];
}

export interface OutgoingMail {
  accountId: AccountId;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string[];
}

type Credentials = { user: string; pass: string } | { user: string; accessToken: string };

export interface MailServiceOptions {
  env?: NodeJS.ProcessEnv;
  /** Accounts added in the app. Without it, only .env accounts are available. */
  store?: ConfigStore;
  /** Needed for "Sign in with Google" accounts. */
  google?: GoogleClient;
}

// .env accounts (from the first version of the app) keep working alongside app-added ones.
function loadEnvAccounts(env: NodeJS.ProcessEnv): Account[] {
  const preset = (id: string) => MAIL_PRESETS.find((p) => p.id === id)!;
  const defs = [
    { ...preset("gmail"), user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    { ...preset("icloud"), user: env.ICLOUD_USER, pass: env.ICLOUD_APP_PASSWORD },
    {
      id: "zoho",
      user: env.ZOHO_USER,
      pass: env.ZOHO_APP_PASSWORD,
      label: "Zoho",
      imap: { ...preset("zoho").imap, host: env.ZOHO_IMAP_HOST || preset("zoho").imap.host },
      smtp: { ...preset("zoho").smtp, host: env.ZOHO_SMTP_HOST || preset("zoho").smtp.host },
    },
  ];
  return defs.flatMap(({ id, user, pass, label, imap, smtp }) =>
    user && pass
      ? [{ id, label, address: user, source: "env" as const, imap, smtp, authType: "password" as const, user, secret: () => pass }]
      : [],
  );
}

export class MailService {
  private envAccounts: Account[];
  private store?: ConfigStore;
  private google?: GoogleClient;
  private accessTokens = new Map<AccountId, { accessToken: string; expiresAt: number }>();

  constructor({ env = process.env, store, google }: MailServiceOptions = {}) {
    this.envAccounts = loadEnvAccounts(env);
    this.store = store;
    this.google = google;
  }

  get canManageAccounts(): boolean {
    return this.store !== undefined;
  }

  get canSignInWithGoogle(): boolean {
    return this.store !== undefined && this.google !== undefined;
  }

  private all(): Account[] {
    const store = this.store;
    const appAccounts: Account[] = (store?.accounts() ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      address: a.address,
      source: "app",
      imap: a.imap,
      smtp: a.smtp,
      authType: a.auth.type,
      user: a.auth.user,
      secret: () => store!.secret(a),
    }));
    return [...this.envAccounts, ...appAccounts];
  }

  listAccounts(): AccountInfo[] {
    return this.all().map(({ id, label, address, source, authType }) => ({ id, label, address, source, authType }));
  }

  hasAccount(id: AccountId): boolean {
    return this.all().some((a) => a.id === id);
  }

  private account(id: AccountId): Account {
    const account = this.all().find((a) => a.id === id);
    if (!account) throw new Error(`Account "${id}" is not configured`);
    return account;
  }

  private async credentials(account: Account): Promise<Credentials> {
    if (account.authType === "password") return { user: account.user, pass: account.secret() };
    if (!this.google) throw new Error("Google sign-in is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
    const cached = this.accessTokens.get(account.id);
    if (cached && cached.expiresAt > Date.now() + 60_000) return { user: account.user, accessToken: cached.accessToken };
    const fresh = await refreshGoogleAccessToken(this.google, account.secret());
    this.accessTokens.set(account.id, fresh);
    return { user: account.user, accessToken: fresh.accessToken };
  }

  /** Log in to IMAP and SMTP without saving anything. Throws with the server's error. */
  async testConnection(host: { imap: HostConfig; smtp: HostConfig }, auth: Credentials): Promise<void> {
    const imap = new ImapFlow({ ...host.imap, auth, logger: false });
    try {
      await imap.connect();
      await imap.logout();
    } catch (err) {
      throw new Error(`IMAP (${host.imap.host}): ${(err as Error).message}`);
    }
    try {
      await smtpTransport(host.smtp, auth).verify();
    } catch (err) {
      throw new Error(`SMTP (${host.smtp.host}): ${(err as Error).message}`);
    }
  }

  async addAccount(input: AccountInput): Promise<AccountInfo> {
    if (!this.store) throw new Error("Accounts can only be added from the desktop app");
    const user = input.user?.trim() || input.address.trim();
    await this.testConnection(input, { user, pass: input.password });
    const stored = this.store.addAccount({
      label: input.label?.trim() || input.address.trim(),
      address: input.address.trim(),
      imap: input.imap,
      smtp: input.smtp,
      auth: { type: "password", user, secret: input.password },
    });
    return this.listAccounts().find((a) => a.id === stored.id)!;
  }

  async addGoogleAccount(openUrl: (url: string) => Promise<void> | void): Promise<AccountInfo> {
    if (!this.store || !this.google) throw new Error("Google sign-in is not configured");
    const { email, refreshToken } = await signInWithGoogle(this.google, openUrl);
    const { accessToken } = await refreshGoogleAccessToken(this.google, refreshToken);
    await this.testConnection(GMAIL_PRESET, { user: email, accessToken });
    const stored = this.store.addAccount({
      label: email,
      address: email,
      imap: GMAIL_PRESET.imap,
      smtp: GMAIL_PRESET.smtp,
      auth: { type: "google", user: email, secret: refreshToken },
    });
    return this.listAccounts().find((a) => a.id === stored.id)!;
  }

  removeAccount(id: AccountId): void {
    if (!this.store || this.account(id).source !== "app") {
      throw new Error("Only accounts added in the app can be removed here; edit .env for the others");
    }
    this.store.removeAccount(id);
    this.accessTokens.delete(id);
  }

  private async withInbox<T>(accountId: AccountId, fn: (imap: ImapFlow) => Promise<T>): Promise<T> {
    const account = this.account(accountId);
    const imap = new ImapFlow({ ...account.imap, auth: await this.credentials(account), logger: false });
    await imap.connect();
    try {
      const lock = await imap.getMailboxLock("INBOX");
      try {
        return await fn(imap);
      } finally {
        lock.release();
      }
    } finally {
      await imap.logout();
    }
  }

  /** Newest `limit` messages in the inbox, newest first. */
  async listInbox(accountId: AccountId, limit = 30): Promise<MessageHeader[]> {
    return this.withInbox(accountId, async (imap) => {
      const total = imap.mailbox ? imap.mailbox.exists : 0;
      if (total === 0) return [];
      const range = `${Math.max(1, total - limit + 1)}:*`;
      const headers: MessageHeader[] = [];
      for await (const msg of imap.fetch(range, { uid: true, envelope: true, flags: true })) {
        const sender = msg.envelope?.from?.[0];
        headers.push({
          accountId,
          uid: msg.uid,
          from: sender ? (sender.name ? `${sender.name} <${sender.address}>` : sender.address ?? "") : "",
          subject: msg.envelope?.subject ?? "(no subject)",
          date: new Date(msg.envelope?.date ?? 0).toISOString(),
          seen: msg.flags?.has("\\Seen") ?? false,
        });
      }
      return headers.reverse();
    });
  }

  async getMessage(accountId: AccountId, uid: number): Promise<MailMessage> {
    return this.withInbox(accountId, async (imap) => {
      const msg = await imap.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) throw new Error(`Message ${uid} not found`);
      const parsed = await simpleParser(msg.source);
      const references = parsed.references ?? [];
      return {
        accountId,
        uid,
        messageId: parsed.messageId,
        references: Array.isArray(references) ? references : [references],
        from: parsed.from?.text ?? "",
        to: addressText(parsed.to),
        subject: parsed.subject ?? "(no subject)",
        date: (parsed.date ?? new Date(0)).toISOString(),
        // Plain-text part when present; otherwise mailparser's HTML-to-text conversion.
        body: parsed.text ?? "",
      };
    });
  }

  async send(mail: OutgoingMail): Promise<void> {
    const account = this.account(mail.accountId);
    const transport = smtpTransport(account.smtp, await this.credentials(account));
    await transport.sendMail({
      from: account.address,
      to: mail.to,
      subject: mail.subject,
      text: mail.body,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
    });
  }
}

function smtpTransport(host: HostConfig, auth: Credentials) {
  return nodemailer.createTransport({
    ...host,
    auth: "accessToken" in auth ? { type: "OAuth2", user: auth.user, accessToken: auth.accessToken } : auth,
  });
}

function addressText(address: AddressObject | AddressObject[] | undefined): string {
  if (!address) return "";
  return (Array.isArray(address) ? address : [address]).map((a) => a.text).join(", ");
}
