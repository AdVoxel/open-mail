import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_DRAFT_ROUTE,
  DEFAULT_TRIAGE_ROUTE,
  type AiRoute,
  type HostConfig,
} from "./presets.js";

/** Encrypts secrets at rest. The desktop app backs this with the macOS Keychain. */
export interface SecretCipher {
  encrypt(plain: string): string;
  decrypt(encrypted: string): string;
}

export type AuthType = "password" | "google";

export interface StoredAccount {
  id: string;
  label: string;
  address: string;
  imap: HostConfig;
  smtp: HostConfig;
  /** `secret` is the encrypted app password or Google refresh token. */
  auth: { type: AuthType; user: string; secret: string };
}

export type NewAccount = Omit<StoredAccount, "id">; // with `auth.secret` in plain text

export type AiJob = "triage" | "draft";

interface StoredAiRoute extends AiRoute {
  apiKey?: string; // encrypted
}

interface ConfigFile {
  version: 1;
  accounts: StoredAccount[];
  ai: Record<AiJob, StoredAiRoute>;
}

/** Accounts and AI settings added in the app, saved as JSON with secrets encrypted. */
export class ConfigStore {
  private data: ConfigFile;

  constructor(
    private path: string,
    private cipher: SecretCipher,
  ) {
    this.data = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as ConfigFile)
      : { version: 1, accounts: [], ai: { triage: DEFAULT_TRIAGE_ROUTE, draft: DEFAULT_DRAFT_ROUTE } };
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

  removeAccount(id: string): void {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id);
    this.save();
  }

  secret(account: StoredAccount): string {
    return this.cipher.decrypt(account.auth.secret);
  }

  aiRoute(job: AiJob): { route: AiRoute; apiKey?: string } {
    const { apiKey, ...route } = this.data.ai[job];
    return { route, apiKey: apiKey ? this.cipher.decrypt(apiKey) : undefined };
  }

  /** `apiKey`: undefined keeps the saved key, null removes it. */
  setAiRoute(job: AiJob, route: AiRoute, apiKey: string | null | undefined): void {
    const previous = this.data.ai[job].apiKey;
    const encrypted = apiKey === undefined ? previous : apiKey ? this.cipher.encrypt(apiKey) : undefined;
    this.data.ai[job] = { ...route, ...(encrypted ? { apiKey: encrypted } : {}) };
    this.save();
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }
}
