// Open tracking: a 1×1 image in sent mail, served by this server at
// /t/<id>.gif. Loading it records an open. Approximate by nature: Apple Mail
// preloads images (opens that weren't), many apps block them (opens missed).
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeJsonAtomic } from "./config.js";
import { escapeHtml } from "./signature.js";
import type { AccountId, OutgoingMail, TrackingSummary } from "./types.js";

const KEEP_DAYS = 365;
const MAX_OPENS = 100;
/** Opens this soon after sending are mail servers scanning the message, not people. */
const IGNORE_FIRST_MS = 10_000;

/** A transparent 1×1 GIF. */
export const TRACKING_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** The pixel's address in a message (to remove it when showing your own copy). */
export const TRACKING_PIXEL = /<img\b[^>]*\/t\/[0-9a-f]{32}\.gif[^>]*>/gi;

interface TrackedMessage {
  id: string;
  messageId: string;
  accountId: AccountId;
  to: string;
  subject: string;
  createdAt: string;
  opens: { at: string; agent?: string }[];
}

export class TrackingStore {
  private records: TrackedMessage[];

  constructor(private path: string) {
    const raw = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { records?: TrackedMessage[] }) : {};
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60_000;
    this.records = (raw.records ?? []).filter((r) => Date.parse(r.createdAt) > cutoff);
  }

  private save(): void {
    writeJsonAtomic(this.path, { version: 1, records: this.records });
  }

  /**
   * Adds the pixel to a message about to be sent, and gives it a Message-ID of
   * its own so the sent copy can be matched with its opens.
   */
  track(accountId: AccountId, address: string, mail: OutgoingMail, publicBase: string): OutgoingMail {
    const id = randomBytes(16).toString("hex");
    const domain = address.split("@")[1] || "mail.local";
    const messageId = `<${randomBytes(12).toString("hex")}.${Date.now().toString(36)}@${domain}>`;
    this.records.push({ id, messageId, accountId, to: mail.to, subject: mail.subject, createdAt: new Date().toISOString(), opens: [] });
    this.save();
    const pixel = `<img src="${publicBase.replace(/\/+$/, "")}/t/${id}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />`;
    const html = mail.html ?? `<div style="white-space: pre-wrap">${escapeHtml(mail.text)}</div>`;
    return { ...mail, html: `${html}${pixel}`, messageId };
  }

  /** The pixel was loaded. Unknown ids are ignored (the image is served either way). */
  recordOpen(id: string, agent: string | undefined): void {
    const record = this.records.find((r) => r.id === id);
    if (!record || Date.now() - Date.parse(record.createdAt) < IGNORE_FIRST_MS) return;
    record.opens.push({ at: new Date().toISOString(), agent: agent?.slice(0, 200) });
    if (record.opens.length > MAX_OPENS) record.opens.splice(0, record.opens.length - MAX_OPENS);
    this.save();
  }

  /** Opens per tracked message (optionally only some Message-IDs). */
  summaries(messageIds?: string[]): TrackingSummary[] {
    const wanted = messageIds ? new Set(messageIds) : null;
    return this.records
      .filter((r) => !wanted || wanted.has(r.messageId))
      .map((r) => ({
        messageId: r.messageId,
        opens: r.opens.length,
        firstOpen: r.opens[0]?.at ?? null,
        lastOpen: r.opens.at(-1)?.at ?? null,
        // Apple's Mail Privacy Protection loads images on delivery, not when read.
        // Its fetches say only "Mozilla/5.0"; Apple Mail itself sends a full user agent.
        appleProxy: r.opens.some((o) => o.agent === "Mozilla/5.0"),
      }));
  }
}
