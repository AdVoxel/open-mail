// Open tracking: a 1×1 image in sent mail, served by this server at
// /t/<id>.gif. Loading it records an open. Approximate by nature: Apple Mail
// preloads images (opens that weren't), many apps block them (opens missed).
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeJsonAtomic } from "./config.js";
import { escapeHtml } from "./signature.js";
import type { AccountId, OutgoingMail, TrackingOpen, TrackingSummary } from "./types.js";

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
  opens: { at: string; agent?: string; ip?: string }[];
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
  recordOpen(id: string, agent: string | undefined, ip?: string): void {
    const record = this.records.find((r) => r.id === id);
    if (!record || Date.now() - Date.parse(record.createdAt) < IGNORE_FIRST_MS) return;
    record.opens.push({ at: new Date().toISOString(), agent: agent?.slice(0, 300), ip: ip?.slice(0, 64) });
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
        events: r.opens.map((o) => ({ at: o.at, ip: o.ip, agent: o.agent, ...describeAgent(o.agent) })).reverse(),
      }));
  }
}

/**
 * What a pixel fetch's user agent says about who loaded it. Mail providers that
 * fetch images themselves are recognized first: their fetches carry the
 * provider's address and agent, not the reader's.
 */
export function describeAgent(agent: string | undefined): Pick<TrackingOpen, "client" | "device" | "proxied"> {
  const ua = agent?.trim() ?? "";
  if (!ua) return { client: "Unknown", proxied: false };
  if (/GoogleImageProxy|ggpht\.com/i.test(ua)) return { client: "Gmail", proxied: true };
  // Apple's Mail Privacy Protection: the bare "Mozilla/5.0", from Apple's relays.
  if (ua === "Mozilla/5.0") return { client: "Apple Mail (privacy protection)", proxied: true };
  if (/YahooMailProxy/i.test(ua)) return { client: "Yahoo Mail", proxied: true };

  const device = deviceOf(ua);
  const version = (re: RegExp) => re.exec(ua)?.[1];
  if (/Outlook-iOS|Outlook-Android/i.test(ua)) return { client: "Outlook mobile", device, proxied: false };
  if (/Microsoft Outlook|ms-office|MSOffice|Microsoft Office/i.test(ua)) {
    const v = version(/(?:Microsoft Outlook|Microsoft Office|MSOffice)[ /](\d+)/i);
    return { client: v ? `Outlook ${v}` : "Outlook", device, proxied: false };
  }
  if (/Thunderbird/i.test(ua)) return { client: `Thunderbird${version(/Thunderbird\/(\d+)/) ? ` ${version(/Thunderbird\/(\d+)/)}` : ""}`, device, proxied: false };
  // Webmail in a browser: the browser's name.
  if (/Edg\//.test(ua)) return { client: "Edge (webmail)", device, proxied: false };
  if (/OPR\//.test(ua)) return { client: "Opera (webmail)", device, proxied: false };
  if (/Firefox\//.test(ua)) return { client: "Firefox (webmail)", device, proxied: false };
  if (/Chrome\//.test(ua)) return { client: "Chrome (webmail)", device, proxied: false };
  if (/Version\/[\d.]+.*Safari\//.test(ua)) return { client: "Safari (webmail)", device, proxied: false };
  // WebKit without a browser name: Apple Mail itself (privacy protection off).
  if (/AppleWebKit/.test(ua) && /Macintosh|iPhone|iPad/.test(ua)) return { client: "Apple Mail", device, proxied: false };
  return { client: ua.split(/[\s/;(]/)[0] || "Unknown", device, proxied: false };
}

function deviceOf(ua: string): string | undefined {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "macOS";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return undefined;
}
