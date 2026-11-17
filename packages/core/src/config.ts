import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HostConfig } from "./presets.js";
import type { AccountUpdate, AuthType } from "./types.js";

/** Encrypts secrets at rest. */
export interface SecretCipher {
  encrypt(plain: string): string;
  decrypt(encrypted: string): string;
}

/**
 * AES-256-GCM with a 32-byte key. On the server the key comes from the
 * MAIL_APP_SECRET_KEY environment variable.
 */
export function aesCipher(key: Buffer): SecretCipher {
  if (key.length !== 32) throw new Error("The secret key must be 32 bytes");
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
    },
    decrypt(encrypted) {
      if (!encrypted.startsWith("v1:")) throw new Error("Unknown secret format");
      const raw = Buffer.from(encrypted.slice(3), "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}

export interface StoredAccount {
  id: string;
  label: string;
  color?: string;
  signature?: string;
  name?: string;
  address: string;
  imap: HostConfig;
  smtp: HostConfig;
  saveSentCopy?: boolean;
  /** Import the address book (missing: on). */
  importContacts?: boolean;
  calendar?: {
    enabled?: boolean;
    hidden?: string[];
    /** Encrypted Google refresh token with calendar access (Gmail accounts that signed in with an app password). */
    googleSecret?: string;
  };
  /** `secret` is the encrypted app password or Google refresh token. */
  auth: { type: AuthType; user: string; secret: string };
}

export type NewAccount = Omit<StoredAccount, "id">; // with `auth.secret` in plain text

interface ConfigFile {
  version: 2;
  accounts: StoredAccount[];
  /** Google OAuth client saved from the apps (the secret encrypted). Environment variables win over it. */
  google?: { clientId: string; clientSecret: string };
}

/** Accounts added through the API, saved as JSON with secrets encrypted. */
export class ConfigStore {
  private data: ConfigFile;

  constructor(
    private path: string,
    private cipher: SecretCipher,
  ) {
    const raw = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Partial<ConfigFile>) : {};
    this.data = { version: 2, accounts: raw.accounts ?? [], google: raw.google };
  }

  accounts(): StoredAccount[] {
    return this.data.accounts;
  }

  addAccount(account: NewAccount): StoredAccount {
    const stored: StoredAccount = {
      ...account,
      id: randomUUID(),
      auth: { ...account.auth, secret: this.cipher.encrypt(account.auth.secret) },
    };
    this.data.accounts.push(stored);
    this.save();
    return stored;
  }

  updateAccount(id: string, update: AccountUpdate): void {
    const account = this.data.accounts.find((a) => a.id === id);
    if (!account) throw new Error(`Account "${id}" not found`);
    if (update.label !== undefined) account.label = update.label;
    if (update.color !== undefined) account.color = update.color;
    if (update.signature !== undefined) account.signature = update.signature;
    if (update.name !== undefined) account.name = update.name;
    if (update.saveSentCopy !== undefined) account.saveSentCopy = update.saveSentCopy;
    if (update.importContacts !== undefined) account.importContacts = update.importContacts;
    this.save();
  }

  updateCalendar(id: string, update: { enabled?: boolean; hidden?: string[] }): void {
    const account = this.find(id);
    account.calendar = { ...account.calendar };
    if (update.enabled !== undefined) account.calendar.enabled = update.enabled;
    if (update.hidden !== undefined) account.calendar.hidden = update.hidden;
    this.save();
  }

  /** Stores (encrypted) or forgets the Google calendar refresh token. */
  setCalendarToken(id: string, refreshToken: string | null): void {
    const account = this.find(id);
    account.calendar = { ...account.calendar, googleSecret: refreshToken ? this.cipher.encrypt(refreshToken) : undefined };
    if (!refreshToken) account.calendar.enabled = false;
    this.save();
  }

  calendarToken(account: StoredAccount): string | null {
    return account.calendar?.googleSecret ? this.cipher.decrypt(account.calendar.googleSecret) : null;
  }

  private find(id: string): StoredAccount {
    const account = this.data.accounts.find((a) => a.id === id);
    if (!account) throw new Error(`Account "${id}" not found`);
    return account;
  }

  googleClient(): { clientId: string; clientSecret: string } | undefined {
    const google = this.data.google;
    return google ? { clientId: google.clientId, clientSecret: this.cipher.decrypt(google.clientSecret) } : undefined;
  }

  setGoogleClient(client: { clientId: string; clientSecret: string } | null): void {
    this.data.google = client ? { clientId: client.clientId, clientSecret: this.cipher.encrypt(client.clientSecret) } : undefined;
    this.save();
  }

  removeAccount(id: string): void {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id);
    this.save();
  }

  secret(account: StoredAccount): string {
    return this.cipher.decrypt(account.auth.secret);
  }

  private save(): void {
    writeJsonAtomic(this.path, this.data);
  }
}

export function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}
