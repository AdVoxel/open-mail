// Contacts of every account that has them, imported on their own and kept on
// disk: iCloud over CardDAV, Gmail over the People API.
import { existsSync, readFileSync } from "node:fs";
import { writeJsonAtomic, type ConfigStore } from "./config.js";
import { GoogleContacts } from "./contacts-google.js";
import { ICloudContacts } from "./contacts-icloud.js";
import type { GoogleClientSource } from "./google-oauth.js";
import { describe, MailError, type MailService } from "./mail.js";
import type { AccountId, AccountInfo, Contact, ContactsPage, ContactUpdate } from "./types.js";

/** How often contacts are imported again. */
const REFRESH_MS = 60 * 60_000;

interface Imported {
  contacts: Contact[];
  /** Last import attempt (ISO). */
  at: string;
  error?: string;
}

interface ContactsFile {
  accounts: Record<AccountId, Imported>;
}

export class ContactService {
  private icloud: ICloudContacts;
  private google: GoogleContacts;
  private data: ContactsFile;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private path: string,
    private mail: MailService,
    store: ConfigStore | undefined,
    googleClient: GoogleClientSource = () => undefined,
  ) {
    this.icloud = new ICloudContacts((id) => mail.passwordLogin(id));
    this.google = new GoogleContacts(googleClient, (id) => {
      const stored = store?.accounts().find((a) => a.id === id);
      return stored ? store!.calendarToken(stored) : null;
    });
    let data: ContactsFile = { accounts: {} };
    try {
      if (existsSync(path)) data = JSON.parse(readFileSync(path, "utf8")) as ContactsFile;
    } catch (err) {
      console.warn(`[contacts] couldn't read ${path}, importing again: ${describe(err)}`);
    }
    this.data = { accounts: data.accounts ?? {} };
  }

  /** Accounts to import from: the option is on, and the server can read them (iCloud always, Gmail after "Connect Google"). */
  private sources(): AccountInfo[] {
    return this.mail
      .listAccounts()
      .filter((a) => a.importContacts !== false && a.calendar.connected && (a.calendar.provider === "icloud" || a.calendar.provider === "google"));
  }

  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list(): ContactsPage {
    const sources = new Set(this.sources().map((a) => a.id));
    const imported = Object.entries(this.data.accounts).filter(([id]) => sources.has(id));
    const contacts = imported
      .flatMap(([, i]) => i.contacts)
      .sort((a, b) => Number(a.auto ?? false) - Number(b.auto ?? false) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const times = imported.map(([, i]) => i.at).sort();
    return {
      contacts,
      errors: imported.filter(([, i]) => i.error).map(([accountId, i]) => ({ accountId, error: i.error! })),
      updatedAt: times.at(-1) ?? null,
      refreshing: this.running !== null,
    };
  }

  /** Changes a contact at its source (Google or iCloud), then here. */
  async update(contactId: string, update: ContactUpdate): Promise<Contact> {
    const entry = Object.entries(this.data.accounts).find(([, i]) => i.contacts.some((c) => c.id === contactId));
    if (!entry) throw new MailError(404, "Contact not found; refresh the contacts and try again");
    const [accountId, imported] = entry;
    const account = this.sources().find((a) => a.id === accountId);
    if (!account) throw new MailError(409, "This contact's account no longer imports contacts");
    const current = imported.contacts.find((c) => c.id === contactId)!;
    if (current.auto) throw new MailError(409, "Contacts Gmail saved on its own can't be edited; add them to your Google contacts first");
    const name = update.name.trim();
    const clean = {
      name,
      organization: update.organization.trim(),
      emails: [...new Set(update.emails.map((e) => e.trim()).filter(Boolean))],
      phones: [...new Set(update.phones.map((p) => p.trim()).filter(Boolean))],
    };
    if (!clean.name && !clean.organization && !clean.emails.length) throw new MailError(400, "Give the contact a name or an email address");
    const bad = clean.emails.find((e) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e));
    if (bad) throw new MailError(400, `"${bad}" isn't an email address`);
    const sourceId = contactId.slice(accountId.length + 1);
    const contact =
      account.calendar.provider === "icloud"
        ? await this.icloud.update(accountId, sourceId, clean)
        : await this.google.update(accountId, sourceId, clean);
    imported.contacts = imported.contacts.map((c) => (c.id === contactId ? contact : c));
    writeJsonAtomic(this.path, this.data);
    return contact;
  }

  /** Imports every account's contacts again (one import at a time; a second call waits for the running one). */
  refresh(): Promise<void> {
    this.running ??= this.importAll().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async importAll(): Promise<void> {
    const sources = this.sources();
    await Promise.all(
      sources.map(async (account) => {
        const at = new Date().toISOString();
        try {
          const contacts = account.calendar.provider === "icloud" ? await this.icloud.list(account.id) : await this.google.list(account.id);
          this.data.accounts[account.id] = { contacts, at };
        } catch (err) {
          // Keep the last imported contacts; say why they're not fresh.
          this.data.accounts[account.id] = { contacts: this.data.accounts[account.id]?.contacts ?? [], at, error: describe(err) };
          console.warn(`[contacts ${account.address}] import failed: ${describe(err)}`);
        }
      }),
    );
    // Forget removed or disconnected accounts.
    const keep = new Set(sources.map((a) => a.id));
    for (const id of Object.keys(this.data.accounts)) if (!keep.has(id)) delete this.data.accounts[id];
    writeJsonAtomic(this.path, this.data);
  }
}
