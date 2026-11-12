// Gmail accounts' calendars over the Google Calendar API, with the refresh token
// from "Connect Google Calendar" (app passwords don't give calendar access).
import { refreshGoogleAccessToken, type GoogleClientSource } from "./google-oauth.js";
import { MailError } from "./mail.js";
import { paletteColor } from "./presets.js";
import type { AccountId, CalendarEvent, CalendarInfo, EventInput, InvitationResponse, InvitationStatus } from "./types.js";

const API = "https://www.googleapis.com/calendar/v3";
const CALENDARS_MS = 5 * 60_000;

interface GoogleTime {
  date?: string;
  dateTime?: string;
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  recurringEventId?: string;
  recurrence?: string[];
  attendees?: GoogleAttendee[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  reminders?: { useDefault?: boolean; overrides?: GoogleReminder[] };
}

interface GoogleAttendee {
  email?: string;
  displayName?: string;
  self?: boolean;
  responseStatus?: "needsAction" | "accepted" | "tentative" | "declined";
}

interface GoogleReminder {
  method?: string;
  minutes?: number;
}

interface GoogleCalendarEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: string;
  defaultReminders?: GoogleReminder[];
}

/** Pop-up reminders, in minutes before the start (email reminders are Google's to send). */
function popupMinutes(reminders: GoogleReminder[] | undefined): number[] {
  return [...new Set((reminders ?? []).filter((r) => r.method === "popup" && typeof r.minutes === "number").map((r) => r.minutes!))].sort((a, b) => b - a);
}

export class GoogleCalendars {
  private tokens = new Map<AccountId, { accessToken: string; expiresAt: number }>();
  private calendars = new Map<AccountId, { list: Omit<CalendarInfo, "visible">[]; defaults: Map<string, number[]>; at: number }>();

  constructor(
    private client: GoogleClientSource,
    private refreshToken: (id: AccountId) => string | null,
  ) {}

  forget(id: AccountId): void {
    this.tokens.delete(id);
    this.calendars.delete(id);
  }

  private async accessToken(id: AccountId): Promise<string> {
    const cached = this.tokens.get(id);
    if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.accessToken;
    const client = this.client();
    if (!client) throw new MailError(501, "Google sign-in isn't set up: add the OAuth client in Settings");
    const token = this.refreshToken(id);
    if (!token) throw new MailError(409, "Google Calendar isn't connected for this account");
    const fresh = await refreshGoogleAccessToken(client, token);
    this.tokens.set(id, fresh);
    return fresh.accessToken;
  }

  private async request<T>(id: AccountId, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}${path}`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${await this.accessToken(id)}`,
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      if (res.status === 401 && attempt === 0) {
        this.tokens.delete(id); // expired early: refresh once
        continue;
      }
      if (res.status === 204) return undefined as T;
      const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
      if (!res.ok) {
        const message = data.error?.message ?? `HTTP ${res.status}`;
        throw new MailError(res.status >= 500 ? 502 : res.status === 404 ? 404 : res.status === 403 ? 403 : 400, `Google Calendar: ${message}`);
      }
      return data;
    }
  }

  async listCalendars(id: AccountId): Promise<Omit<CalendarInfo, "visible">[]> {
    const cached = this.calendars.get(id);
    if (cached && Date.now() - cached.at < CALENDARS_MS) return cached.list;
    const entries: GoogleCalendarEntry[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.request<{ items?: GoogleCalendarEntry[]; nextPageToken?: string }>(
        id,
        `/users/me/calendarList?maxResults=250${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      );
      entries.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    const defaults = new Map(entries.map((c) => [c.id, popupMinutes(c.defaultReminders)]));
    const list = entries.map((c) => ({
      id: c.id,
      accountId: id,
      name: c.summaryOverride || c.summary || c.id,
      color: /^#[0-9a-f]{6}$/i.test(c.backgroundColor ?? "") ? c.backgroundColor!.toLowerCase() : paletteColor(c.id),
      readOnly: c.accessRole !== "owner" && c.accessRole !== "writer",
    }));
    this.calendars.set(id, { list, defaults, at: Date.now() });
    return list;
  }

  /** The calendar's default reminders (used by events that keep the defaults). */
  private defaultAlerts(id: AccountId, calendarId: string): number[] {
    return this.calendars.get(id)?.defaults.get(calendarId) ?? [];
  }

  private async writable(id: AccountId, calendarId: string): Promise<boolean> {
    const calendar = (await this.listCalendars(id)).find((c) => c.id === calendarId);
    if (!calendar) throw new MailError(404, "Calendar not found");
    return !calendar.readOnly;
  }

  async listEvents(id: AccountId, calendarId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    const writable = await this.writable(id, calendarId);
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: "true", // Google expands repeats into occurrences
        orderBy: "startTime",
        maxResults: "2500",
      });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await this.request<{ items?: GoogleEvent[]; nextPageToken?: string }>(
        id,
        `/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
      );
      const defaults = this.defaultAlerts(id, calendarId);
      for (const e of page.items ?? []) if (e.status !== "cancelled") events.push(fromGoogle(e, id, calendarId, writable, defaults));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return events;
  }

  async createEvent(id: AccountId, calendarId: string, input: EventInput): Promise<CalendarEvent> {
    if (!(await this.writable(id, calendarId))) throw new MailError(403, "This calendar is read-only");
    const event = await this.request<GoogleEvent>(id, `/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      body: toGoogle(input),
    });
    return fromGoogle(event, id, calendarId, true, this.defaultAlerts(id, calendarId));
  }

  async updateEvent(id: AccountId, calendarId: string, eventId: string, input: EventInput): Promise<CalendarEvent> {
    await this.editable(id, calendarId, eventId);
    // PATCH: fields the app doesn't send (reminders, colors, conferencing…) stay as they are.
    const event = await this.request<GoogleEvent>(id, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: toGoogle(input),
    });
    return fromGoogle(event, id, calendarId, true, this.defaultAlerts(id, calendarId));
  }

  /** Answers an invitation: your attendee entry's responseStatus; Google tells the organizer. */
  async respond(id: AccountId, calendarId: string, eventId: string, response: InvitationResponse): Promise<void> {
    const path = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    const event = await this.request<GoogleEvent>(id, path);
    const attendees = event.attendees ?? [];
    const me = attendees.find((a) => a.self);
    if (!me) throw new MailError(409, "You're not a guest of this event");
    me.responseStatus = response;
    // The whole list goes back (PATCH replaces arrays); only your answer changed.
    await this.request(id, `${path}?sendUpdates=all`, { method: "PATCH", body: { attendees } });
  }

  async deleteEvent(id: AccountId, calendarId: string, eventId: string): Promise<void> {
    await this.editable(id, calendarId, eventId);
    await this.request(id, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  }

  private async editable(id: AccountId, calendarId: string, eventId: string): Promise<void> {
    const writable = await this.writable(id, calendarId);
    const event = await this.request<GoogleEvent>(id, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    const current = fromGoogle(event, id, calendarId, writable, []);
    if (!writable) throw new MailError(403, "This calendar is read-only");
    if (current.recurring) throw new MailError(409, "Repeating events can't be changed from the app yet");
    if (current.hasAttendees) throw new MailError(409, "Events with guests can't be changed from the app yet");
  }
}

const STATUS: Record<string, InvitationStatus> = { needsAction: "needs-action", accepted: "accepted", tentative: "tentative", declined: "declined" };

function fromGoogle(e: GoogleEvent, accountId: AccountId, calendarId: string, writable: boolean, defaultAlerts: number[]): CalendarEvent {
  const allDay = Boolean(e.start?.date);
  const recurring = Boolean(e.recurringEventId || e.recurrence?.length);
  const hasAttendees = (e.attendees ?? []).some((a) => !a.self);
  const me = (e.attendees ?? []).find((a) => a.self);
  return {
    id: e.id,
    accountId,
    calendarId,
    title: e.summary || "(no title)",
    start: allDay ? e.start!.date! : new Date(e.start?.dateTime ?? 0).toISOString(),
    end: allDay ? (e.end?.date ?? e.start!.date!) : new Date(e.end?.dateTime ?? e.start?.dateTime ?? 0).toISOString(),
    allDay,
    location: e.location ?? "",
    description: e.description ?? "",
    recurring,
    hasAttendees,
    editable: writable && !recurring && !hasAttendees,
    alerts: e.reminders?.useDefault === false ? popupMinutes(e.reminders.overrides) : defaultAlerts,
    invitation:
      me && !e.organizer?.self
        ? { organizer: e.organizer?.displayName || e.organizer?.email || "the organizer", status: STATUS[me.responseStatus ?? "needsAction"] ?? "needs-action" }
        : undefined,
  };
}

function toGoogle(input: EventInput) {
  // Both keys, so switching between all-day and timed clears the other one on PATCH.
  const time = (value: string) => (input.allDay ? { date: value.slice(0, 10), dateTime: null } : { dateTime: new Date(value).toISOString(), date: null });
  return {
    summary: input.title.trim() || "(no title)",
    location: input.location ?? "",
    description: input.description ?? "",
    start: time(input.start),
    end: time(input.end),
  };
}
