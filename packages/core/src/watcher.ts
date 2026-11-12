// Notices new mail in every account's inbox and tells listeners (the server's
// event stream), so the apps can show notifications and refresh.
import { EventEmitter } from "node:events";
import { describe, type MailService } from "./mail.js";
import type { AccountId, NewMail } from "./types.js";

/** Mail older than this when first seen (e.g. moved back into the inbox) isn't announced. */
const MAX_AGE_MS = 24 * 60 * 60_000;

export class NewMailWatcher extends EventEmitter<{ mail: [NewMail] }> {
  private seen = new Map<AccountId, { uidValidity: string; uid: number }>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private mail: MailService,
    private intervalMs = 30_000,
  ) {
    super();
    this.setMaxListeners(100); // one per connected app
  }

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), this.intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private async check(): Promise<void> {
    if (this.running) return; // a slow server shouldn't stack checks
    this.running = true;
    try {
      const accounts = this.mail.listAccounts();
      for (const id of this.seen.keys()) if (!accounts.some((a) => a.id === id)) this.seen.delete(id);
      for (const account of accounts) {
        try {
          const { arrived, ...state } = await this.mail.inboxSince(account.id, this.seen.get(account.id));
          this.seen.set(account.id, state);
          for (const mail of arrived) {
            if (mail.message.seen || Date.now() - Date.parse(mail.message.date) > MAX_AGE_MS) continue;
            this.emit("mail", mail);
          }
        } catch (err) {
          console.warn(`[new mail ${account.address}] ${describe(err)}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
