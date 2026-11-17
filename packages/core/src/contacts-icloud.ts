// iCloud contacts over CardDAV, signed in with the account's app-specific password
// (the same login as its mail and calendar).
import { createDAVClient } from "tsdav";
import { MailError } from "./mail.js";
import type { AccountId, Contact, ContactUpdate } from "./types.js";

const SERVER_URL = "https://contacts.icloud.com";

type Login = (id: AccountId) => { user: string; pass: string };

export class ICloudContacts {
  constructor(private login: Login) {}

  private async client(id: AccountId) {
    const { user, pass } = this.login(id);
    try {
      return await createDAVClient({
        serverUrl: SERVER_URL,
        credentials: { username: user, password: pass },
        authMethod: "Basic",
        defaultAccountType: "carddav",
      });
    } catch (err) {
      throw new MailError(502, `iCloud contacts sign-in failed: ${(err as Error).message}`);
    }
  }

  async list(id: AccountId): Promise<Contact[]> {
    const client = await this.client(id);
    const contacts: Contact[] = [];
    for (const addressBook of await client.fetchAddressBooks()) {
      for (const card of await client.fetchVCards({ addressBook })) {
        if (!card.data) continue;
        const contact = parseVCard(card.data);
        if (contact) contacts.push({ ...contact, id: `${id}:${card.url}`, accountId: id });
      }
    }
    return contacts;
  }

  /** Rewrites the card's name, company, emails and phones; everything else on it (birthday, address, photo…) is kept. */
  async update(id: AccountId, url: string, update: ContactUpdate): Promise<Contact> {
    const client = await this.client(id);
    const addressBook = (await client.fetchAddressBooks()).find((b) => url.startsWith(b.url));
    if (!addressBook) throw new MailError(404, "Contact not found");
    const [card] = await client.fetchVCards({ addressBook, objectUrls: [url] });
    if (!card?.data) throw new MailError(404, "Contact not found");
    const data = rewriteVCard(card.data, update);
    const res = await client.updateVCard({ vCard: { url, data, etag: card.etag } });
    if (res.status === 412) throw new MailError(409, "The contact changed on another device. Refresh and try again.");
    if (!res.ok) throw new MailError(502, `iCloud refused the change (HTTP ${res.status})`);
    const parsed = parseVCard(data);
    if (!parsed) throw new MailError(502, "The changed contact couldn't be read");
    return { ...parsed, id: `${id}:${url}`, accountId: id };
  }
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** Physical lines → logical (unfolded) lines. */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n").filter((l) => l.length > 0);
}

function propertyOf(line: string): { group: string | null; name: string; value: string } {
  const colon = line.indexOf(":");
  const head = colon < 0 ? line : line.slice(0, colon);
  const key = head.split(";")[0]!;
  const dot = key.lastIndexOf(".");
  return { group: dot >= 0 ? key.slice(0, dot) : null, name: key.slice(dot + 1).toUpperCase(), value: colon < 0 ? "" : line.slice(colon + 1) };
}

/**
 * The card with new FN/N/ORG/EMAIL/TEL. Emails and phones that stay keep their
 * line (and type); labels of removed ones (itemN.X-ABLabel) go with them.
 */
export function rewriteVCard(text: string, update: ContactUpdate): string {
  const lines = unfold(text);
  const wantEmails = new Map(update.emails.map((e) => [e.trim().toLowerCase(), e.trim()]).filter(([k]) => k) as [string, string][]);
  const wantPhones = new Map(update.phones.map((p) => [p.trim(), p.trim()]).filter(([k]) => k) as [string, string][]);
  const droppedGroups = new Set<string>();
  const kept: string[] = [];
  let oldName = "";
  let oldN: string | null = null;
  let oldOrg: string | null = null;
  for (const line of lines) {
    const { group, name, value } = propertyOf(line);
    if (name === "FN") oldName = value;
    if (name === "N") oldN = line;
    if (name === "ORG") oldOrg = line;
    if (name === "EMAIL") {
      const key = value.replace(/^mailto:/i, "").replace(/\\(.)/g, "$1").trim().toLowerCase();
      if (wantEmails.has(key)) {
        wantEmails.delete(key);
        kept.push(line);
      } else if (group) droppedGroups.add(group);
      continue;
    }
    if (name === "TEL") {
      const key = value.replace(/^tel:/i, "").replace(/\\(.)/g, "$1").trim();
      if (wantPhones.has(key)) {
        wantPhones.delete(key);
        kept.push(line);
      } else if (group) droppedGroups.add(group);
      continue;
    }
    if (name === "FN" || name === "N" || name === "ORG") continue;
    kept.push(line);
  }
  const result = kept.filter((line) => {
    const { group, name } = propertyOf(line);
    return !(group && droppedGroups.has(group) && name !== "EMAIL" && name !== "TEL");
  });
  const fields: string[] = [];
  const fullName = update.name.trim();
  fields.push(`FN:${escapeText(fullName)}`);
  // N: unchanged name keeps its parts; a new one is split "Given Family" on the last space.
  if (oldN && fullName === oldName.replace(/\\(.)/g, "$1").trim()) fields.push(oldN);
  else {
    const space = fullName.lastIndexOf(" ");
    const given = space > 0 ? fullName.slice(0, space) : fullName;
    const family = space > 0 ? fullName.slice(space + 1) : "";
    fields.push(`N:${escapeText(family)};${escapeText(given)};;;`);
  }
  if (update.organization.trim()) {
    const rest = oldOrg ? propertyOf(oldOrg).value.split(/(?<!\\);/).slice(1) : [];
    fields.push(`ORG:${[escapeText(update.organization.trim()), ...rest].join(";")}`);
  }
  for (const email of wantEmails.values()) fields.push(`EMAIL;type=INTERNET:${email}`);
  for (const phone of wantPhones.values()) fields.push(`TEL:${escapeText(phone)}`);
  // After VERSION (or BEGIN), so the card stays well-formed.
  const at = Math.max(result.findIndex((l) => /^VERSION:/i.test(l)), result.findIndex((l) => /^BEGIN:VCARD/i.test(l)));
  result.splice(at + 1, 0, ...fields);
  return result.join("\r\n") + "\r\n";
}

type ParsedContact = Omit<Contact, "id" | "accountId">;

/** The fields the app shows, from one vCard (3.0 or 4.0). Groups and empty cards give null. */
export function parseVCard(text: string): ParsedContact | null {
  // Unfold continuation lines (a line starting with a space or tab continues the previous one).
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  let fn = "";
  let structured = "";
  let organization = "";
  const emails: string[] = [];
  const phones: string[] = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    // "item1.EMAIL;type=INTERNET" → "EMAIL"
    const name = line.slice(0, colon).split(";")[0]!.split(".").pop()!.toUpperCase();
    const value = line.slice(colon + 1);
    if (name === "X-ADDRESSBOOKSERVER-KIND" && value.trim().toLowerCase() === "group") return null;
    if (name === "KIND" && value.trim().toLowerCase() === "group") return null;
    if (name === "FN") fn = unescape(value).trim();
    else if (name === "N") {
      const [family = "", given = ""] = splitUnescaped(value);
      structured = [given, family].map((s) => s.trim()).filter(Boolean).join(" ");
    } else if (name === "ORG") organization = splitUnescaped(value)[0]?.trim() ?? "";
    else if (name === "EMAIL") {
      const email = unescape(value).trim().replace(/^mailto:/i, "");
      if (email.includes("@") && !emails.some((e) => e.toLowerCase() === email.toLowerCase())) emails.push(email);
    } else if (name === "TEL") {
      const phone = unescape(value).trim().replace(/^tel:/i, "");
      if (phone && !phones.includes(phone)) phones.push(phone);
    }
  }
  const display = fn || structured || organization || emails[0] || "";
  if (!display && !phones.length) return null;
  return { name: display || phones[0]!, emails, phones, organization };
}

function unescape(value: string): string {
  return value.replace(/\\([\\,;nN])/g, (_m, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** Splits a structured value (N, ORG) on unescaped semicolons. */
function splitUnescaped(value: string): string[] {
  return value.split(/(?<!\\);/).map(unescape);
}
