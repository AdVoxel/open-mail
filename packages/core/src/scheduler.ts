import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeJsonAtomic } from "./config.js";
import { describe, MailError, type MailService } from "./mail.js";
import type { AccountId, OutgoingMail, ScheduledMail } from "./types.js";

export interface SchedulerOptions {
  /** How often to look for due messages. */
  intervalMs?: number;
  /** Failed sends are retried this many times in total before giving up. */
  maxAttempts?: number;
  /** Wait between retries, multiplied by the attempt number. */
  retryDelayMs?: number;
}

export type ScheduleUpdate = Partial<OutgoingMail> & { accountId?: AccountId; sendAt?: Date };

/**
 * Sends mail at a later time. The queue is a JSON file, so scheduled mail
 * survives restarts; the server just has to be running at send time.
 */
export class Scheduler {
  private items: ScheduledMail[];
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private intervalMs: number;
  private maxAttempts: number;
  private retryDelayMs: number;

  constructor(
    private path: string,
    private mail: MailService,
    { intervalMs = 10_000, maxAttempts = 3, retryDelayMs = 60_000 }: SchedulerOptions = {},
  ) {
    this.intervalMs = intervalMs;
    this.maxAttempts = maxAttempts;
    this.retryDelayMs = retryDelayMs;
    this.items = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ScheduledMail[]) : [];
    // A send cut off by a restart may or may not have gone out: don't risk sending twice.
    for (const item of this.items) {
      if (item.status === "sending") {
        item.status = "failed";
        item.error = "The server stopped while sending. Check the Sent folder before retrying.";
      }
    }
    this.save();
  }

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  list(): ScheduledMail[] {
    return [...this.items].sort((a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt));
  }

  get(id: string): ScheduledMail {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new MailError(404, "Scheduled message not found");
    return item;
  }

  create(accountId: AccountId, mail: OutgoingMail, sendAt: Date): ScheduledMail {
    if (!this.mail.hasAccount(accountId)) throw new MailError(404, `Account "${accountId}" is not configured`);
    const now = new Date().toISOString();
    const item: ScheduledMail = {
      ...mail,
      id: randomUUID(),
      accountId,
      sendAt: sendAt.toISOString(),
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(item);
    this.save();
    return item;
  }

  /** Edit a pending or failed message; a failed one is queued again. */
  update(id: string, { sendAt, accountId, ...mail }: ScheduleUpdate): ScheduledMail {
    const item = this.get(id);
    if (item.status === "sending" || item.status === "sent") {
      throw new MailError(409, `This message is already ${item.status === "sent" ? "sent" : "being sent"}`);
    }
    if (accountId !== undefined && !this.mail.hasAccount(accountId)) {
      throw new MailError(404, `Account "${accountId}" is not configured`);
    }
    Object.assign(item, Object.fromEntries(Object.entries(mail).filter(([, v]) => v !== undefined)));
    if (accountId) item.accountId = accountId;
    if (sendAt) item.sendAt = sendAt.toISOString();
    item.status = "pending";
    item.attempts = 0;
    delete item.error;
    delete item.retryAt;
    item.updatedAt = new Date().toISOString();
    this.save();
    return item;
  }

  remove(id: string): void {
    if (this.get(id).status === "sending") throw new MailError(409, "This message is being sent right now");
    this.items = this.items.filter((i) => i.id !== id);
    this.save();
  }

  /** Send right away (also used to retry a failed message). Resolves once it's sent or failed. */
  async sendNow(id: string): Promise<ScheduledMail> {
    const item = this.update(id, { sendAt: new Date() });
    await this.process(item);
    return item;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const due = this.items.filter((i) => i.status === "pending" && Date.parse(i.retryAt ?? i.sendAt) <= now);
      for (const item of due) await this.process(item);
    } finally {
      this.ticking = false;
    }
  }

  private async process(item: ScheduledMail): Promise<void> {
    if (item.status !== "pending") return;
    item.status = "sending";
    item.attempts += 1;
    this.save();
    try {
      const { messageId } = await this.mail.send(item.accountId, item);
      item.status = "sent";
      item.sentAt = new Date().toISOString();
      item.messageId = messageId;
      delete item.error;
      delete item.retryAt;
    } catch (err) {
      item.error = describe(err);
      const permanent = err instanceof MailError && err.status === 404;
      if (permanent || item.attempts >= this.maxAttempts) {
        item.status = "failed";
        delete item.retryAt;
      } else {
        item.status = "pending";
        item.retryAt = new Date(Date.now() + this.retryDelayMs * item.attempts).toISOString();
      }
      console.warn(`[scheduler] ${item.id} attempt ${item.attempts} failed: ${item.error}`);
    }
    item.updatedAt = new Date().toISOString();
    this.save();
  }

  private save(): void {
    writeJsonAtomic(this.path, this.items);
  }
}
