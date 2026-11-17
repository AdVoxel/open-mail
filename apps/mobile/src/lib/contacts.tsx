import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Contact, ContactsPage } from "@mail-app/api-client";
import { useApi } from "./connection";

/** How often the app picks up what the server imported (the server imports every hour). */
const RELOAD_MS = 10 * 60_000;

/** One address to suggest: a contact's email. */
export interface Suggestion {
  name: string;
  email: string;
  contact: Contact;
}

interface ContactsState {
  page: ContactsPage | null;
  error: string | null;
  /** Re-reads what the server has. */
  reload: () => Promise<void>;
  /** Asks the server to import from every account now. */
  refresh: () => Promise<void>;
  /** Addresses whose name or email matches `query`, best first, leaving out `exclude` (already added). */
  suggest: (query: string, exclude?: string[], limit?: number) => Suggestion[];
}

const Context = createContext<ContactsState | null>(null);

export function ContactsProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [page, setPage] = useState<ContactsPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setPage(await api.contacts());
      setError(null);
    } catch (e) {
      const message = (e as Error).message;
      // Older servers have no contacts: an empty list, not an error.
      if (/404|not found/i.test(message)) setPage({ contacts: [], errors: [], updatedAt: null, refreshing: false });
      else setError(message);
    }
  }, [api]);

  const refresh = useCallback(async () => {
    try {
      setPage(await api.refreshContacts());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), RELOAD_MS);
    return () => clearInterval(timer);
  }, [reload]);

  // While the server is still importing (first start), check back soon.
  useEffect(() => {
    if (!page?.refreshing) return;
    const timer = setTimeout(() => void reload(), 5000);
    return () => clearTimeout(timer);
  }, [page, reload]);

  /** Every (contact, email) pair once per address; saved contacts before Gmail's remembered ones. */
  const entries = useMemo(() => {
    const seen = new Set<string>();
    const list: (Suggestion & { haystack: string })[] = [];
    for (const contact of page?.contacts ?? []) {
      for (const email of contact.emails) {
        const key = email.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ name: contact.name === email ? "" : contact.name, email, contact, haystack: `${contact.name} ${email} ${contact.organization}`.toLowerCase() });
      }
    }
    return list;
  }, [page]);

  const suggest = useCallback(
    (query: string, exclude: string[] = [], limit = 6) => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const skip = new Set(exclude.map((e) => e.toLowerCase()));
      const scored: { s: Suggestion; score: number }[] = [];
      for (const entry of entries) {
        if (skip.has(entry.email.toLowerCase())) continue;
        const name = entry.name.toLowerCase();
        const email = entry.email.toLowerCase();
        let score: number;
        if (name.startsWith(q) || email.startsWith(q)) score = 0;
        else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 1;
        else if (entry.haystack.includes(q)) score = 2;
        else continue;
        if (entry.contact.auto) score += 0.5; // saved contacts first
        scored.push({ s: entry, score });
        if (scored.length > 400) break;
      }
      return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((x) => x.s);
    },
    [entries],
  );

  const value = useMemo(() => ({ page, error, reload, refresh, suggest }), [page, error, reload, refresh, suggest]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useContacts(): ContactsState {
  const value = useContext(Context);
  if (!value) throw new Error("useContacts must be used inside ContactsProvider");
  return value;
}

/** "Name <email>", quoting names with commas or other specials so the list still splits right. */
export function formatRecipient(name: string, email: string): string {
  const clean = name.trim();
  if (!clean) return email;
  return /[,;<>@"()[\]:\\]/.test(clean) ? `"${clean.replace(/["\\]/g, "\\$&")}" <${email}>` : `${clean} <${email}>`;
}

/** Splits a recipients field on commas/semicolons outside quotes. */
export function splitRecipients(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if ((ch === "," || ch === ";") && !quoted) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}

/** The bare address of one recipient ("Name <a@b>" → "a@b"). */
export function recipientEmail(part: string): string {
  const match = /<([^>]+)>/.exec(part);
  return (match ? match[1]! : part).trim();
}
