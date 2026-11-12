// The apps' screen lock: one password for every device, stored as a scrypt
// hash in lock.json. Forgotten passwords are reset with a code mailed to one of
// your own accounts. A privacy screen for the apps, not encryption: the API
// token still works for whoever has it.
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeJsonAtomic } from "./config.js";
import { MailError, type MailService } from "./mail.js";
import type { AccountId } from "./types.js";

const MIN_LENGTH = 4;
const CODE_MS = 15 * 60_000;
const CODE_ATTEMPTS = 5;
/** After this many wrong passwords in a row, each further try waits a bit. */
const FREE_ATTEMPTS = 5;

interface LockFile {
  version: 1;
  /** "scrypt:<salt hex>:<hash hex>" */
  password?: string;
}

function hash(password: string): string {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}

function matches(password: string, stored: string): boolean {
  const [, salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}

export class LockService {
  private data: LockFile;
  private failures = 0;
  private reset?: { code: string; accountId: AccountId; expires: number; attempts: number };

  constructor(
    private path: string,
    private mail: MailService,
  ) {
    this.data = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as LockFile) : { version: 1 };
  }

  get enabled(): boolean {
    return Boolean(this.data.password);
  }

  private save(): void {
    writeJsonAtomic(this.path, this.data);
  }

  private setPassword(password: string): void {
    if (password.length < MIN_LENGTH) throw new MailError(400, `Use at least ${MIN_LENGTH} characters`);
    this.data.password = hash(password);
    this.failures = 0;
    this.save();
  }

  /** Throws unless `password` is the current one. Repeated failures slow down. */
  async check(password: string): Promise<void> {
    if (!this.data.password) return;
    if (this.failures >= FREE_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** (this.failures - FREE_ATTEMPTS))));
    }
    if (!matches(password, this.data.password)) {
      this.failures++;
      throw new MailError(403, "Wrong password");
    }
    this.failures = 0;
  }

  /** Turns the lock on, or changes the password (which needs the current one). */
  async set(password: string, currentPassword?: string): Promise<void> {
    if (this.enabled) await this.check(currentPassword ?? "");
    this.setPassword(password);
  }

  async disable(currentPassword: string): Promise<void> {
    await this.check(currentPassword);
    delete this.data.password;
    this.save();
  }

  /** Mails a one-time code to the account's own address. Resolves the address. */
  async requestReset(accountId: AccountId): Promise<string> {
    if (!this.enabled) throw new MailError(409, "The screen lock is off");
    const account = this.mail.listAccounts().find((a) => a.id === accountId);
    if (!account) throw new MailError(404, "Account not found");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.mail.send(accountId, {
      to: account.address,
      subject: `Mail app: your unlock code is ${code}`,
      text: [
        `Your code to set a new screen-lock password in the Mail app: ${code}`,
        "",
        "It works for 15 minutes. If you didn't ask for it, ignore this message: your password stays the same.",
      ].join("\n"),
    });
    this.reset = { code, accountId, expires: Date.now() + CODE_MS, attempts: 0 };
    return account.address;
  }

  /** Sets a new password with a mailed code. */
  confirmReset(code: string, password: string): void {
    const reset = this.reset;
    if (!reset || Date.now() > reset.expires) throw new MailError(410, "The code expired. Ask for a new one.");
    if (++reset.attempts > CODE_ATTEMPTS) {
      this.reset = undefined;
      throw new MailError(429, "Too many wrong codes. Ask for a new one.");
    }
    const given = Buffer.from(code.trim().padEnd(6).slice(0, 6));
    if (!timingSafeEqual(given, Buffer.from(reset.code))) throw new MailError(403, "Wrong code");
    this.setPassword(password);
    this.reset = undefined;
  }
}
