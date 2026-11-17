// Gmail accounts' contacts over the Google People API, with the refresh token
// from "Connect Google" (the same sign-in as the calendar).
import { refreshGoogleAccessToken, type GoogleClientSource } from "./google-oauth.js";
import { MailError } from "./mail.js";
import type { AccountId, Contact, ContactUpdate } from "./types.js";

const API = "https://people.googleapis.com/v1";

interface Person {
  resourceName: string;
  etag?: string;
  names?: { displayName?: string; unstructuredName?: string; givenName?: string; familyName?: string }[];
  emailAddresses?: { value?: string; type?: string }[];
  phoneNumbers?: { value?: string; type?: string }[];
  organizations?: { name?: string; title?: string }[];
}

const FIELDS = "names,emailAddresses,phoneNumbers,organizations";

export class GoogleContacts {
  constructor(
    private client: GoogleClientSource,
    private refreshToken: (id: AccountId) => string | null,
  ) {}

  private async accessToken(id: AccountId): Promise<string> {
    const client = this.client();
    if (!client) throw new MailError(501, "Google sign-in isn't set up: add the OAuth client in Settings");
    const token = this.refreshToken(id);
    if (!token) throw new MailError(409, "Connect Google for this account (Settings → Calendar) to import its contacts");
    return (await refreshGoogleAccessToken(client, token)).accessToken;
  }

  async list(id: AccountId): Promise<Contact[]> {
    const accessToken = await this.accessToken(id);
    const saved = await this.pages(accessToken, "/people/me/connections", { personFields: "names,emailAddresses,phoneNumbers,organizations" });
    // Gmail's "Other contacts" (people you've written to): what Gmail suggests when you type an address.
    const other = await this.pages(accessToken, "/otherContacts", { readMask: "names,emailAddresses,phoneNumbers" });
    const contacts = saved.map((p) => toContact(id, p, false)).filter((c): c is Contact => c !== null);
    const known = new Set(contacts.flatMap((c) => c.emails.map((e) => e.toLowerCase())));
    for (const person of other) {
      const contact = toContact(id, person, true);
      if (contact && !contact.emails.some((e) => known.has(e.toLowerCase()))) contacts.push(contact);
    }
    return contacts;
  }

  /**
   * Changes a saved contact (Gmail's "Other contacts" can't be edited). Entries
   * that stay keep their type (work, mobile…); the rest of the contact is untouched.
   */
  async update(id: AccountId, resourceName: string, update: ContactUpdate): Promise<Contact> {
    if (!resourceName.startsWith("people/")) throw new MailError(409, "Contacts Gmail saved on its own can't be edited; add them to your Google contacts first");
    const accessToken = await this.accessToken(id);
    const url = `${API}/${resourceName}`;
    const headers = { Authorization: `Bearer ${accessToken}` };
    const res = await fetch(`${url}?personFields=${FIELDS}`, { headers });
    const current = (await res.json().catch(() => ({}))) as Person & { error?: { message?: string } };
    if (!res.ok) throw googleError(res.status, current.error?.message);

    const keep = <T extends { value?: string }>(list: T[] | undefined, values: string[]) =>
      values.map((value) => list?.find((e) => e.value?.trim().toLowerCase() === value.toLowerCase()) ?? { value });
    const organizations = update.organization
      ? [{ ...(current.organizations?.[0] ?? {}), name: update.organization }]
      : (current.organizations ?? []).slice(1);
    const body: Person = {
      resourceName,
      etag: current.etag,
      names: update.name ? [{ unstructuredName: update.name }] : [],
      emailAddresses: keep(current.emailAddresses, update.emails),
      phoneNumbers: keep(current.phoneNumbers, update.phones),
      organizations,
    };
    const saved = await fetch(`${url}:updateContact?updatePersonFields=${FIELDS}&personFields=${FIELDS}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const person = (await saved.json().catch(() => ({}))) as Person & { error?: { message?: string } };
    if (saved.status === 400 && /etag/i.test(person.error?.message ?? "")) throw new MailError(409, "The contact changed elsewhere. Refresh and try again.");
    if (!saved.ok) throw googleError(saved.status, person.error?.message);
    const contact = toContact(id, person, false);
    if (!contact) throw new MailError(502, "Google returned an empty contact");
    return contact;
  }

  private async pages(accessToken: string, path: string, params: Record<string, string>): Promise<Person[]> {
    const people: Person[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ ...params, pageSize: "1000" });
      if (pageToken) query.set("pageToken", pageToken);
      const res = await fetch(`${API}${path}?${query}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = (await res.json().catch(() => ({}))) as {
        connections?: Person[];
        otherContacts?: Person[];
        nextPageToken?: string;
        error?: { message?: string };
      };
      if (!res.ok) throw googleError(res.status, data.error?.message);
      people.push(...(data.connections ?? data.otherContacts ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return people;
  }
}

function googleError(status: number, message = `HTTP ${status}`): MailError {
  if (status === 403 && /insufficient.*scope/i.test(message)) {
    return new MailError(403, "Google didn't allow this on your contacts: disconnect and reconnect Google for this account (Settings → Calendar)");
  }
  if (status === 403 && /People API has not been used|is disabled/i.test(message)) {
    return new MailError(403, "Enable the People API in your Google Cloud project (APIs & Services → Library), then refresh");
  }
  return new MailError(status >= 500 ? 502 : status, `Google Contacts: ${message}`);
}

function toContact(accountId: AccountId, p: Person, auto: boolean): Contact | null {
  const emails = [...new Set((p.emailAddresses ?? []).map((e) => e.value?.trim() ?? "").filter((e) => e.includes("@")))];
  const phones = [...new Set((p.phoneNumbers ?? []).map((n) => n.value?.trim() ?? "").filter(Boolean))];
  const organization = p.organizations?.[0]?.name?.trim() ?? "";
  const name = p.names?.[0]?.displayName?.trim() || organization || emails[0] || phones[0] || "";
  if (!name) return null;
  return { id: `${accountId}:${p.resourceName}`, accountId, name, emails, phones, organization, ...(auto ? { auto: true } : {}) };
}
