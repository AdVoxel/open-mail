// iCloud calendars over CalDAV, signed in with the account's app-specific password.
import { randomUUID } from "node:crypto";
import ICAL from "ical.js";
import { createDAVClient, type DAVCalendar, type DAVCalendarObject } from "tsdav";
import { MailError } from "./mail.js";
import { paletteColor } from "./presets.js";
import type { AccountId, CalendarEvent, CalendarInfo, EventInput, InvitationResponse, InvitationStatus } from "./types.js";

const SERVER_URL = "https://caldav.icloud.com";
/** Discovery takes ~2 s, so the client and the calendar list are reused for a while. */
const SESSION_MS = 10 * 60_000;
/** Safety net for very long-running repeats (a daily event for 20 years is ~7300). */
const MAX_OCCURRENCES = 20_000;

type Client = Awaited<ReturnType<typeof createDAVClient>>;
/** The account's login, and the addresses it receives invitations at. */
type Login = (id: AccountId) => { user: string; pass: string; addresses: string[] };

export class ICloudCalendars {
  private sessions = new Map<AccountId, { client: Client; calendars: DAVCalendar[]; self: string[]; at: number }>();

  constructor(private login: Login) {}

  forget(id: AccountId): void {
    this.sessions.delete(id);
  }

  private async session(id: AccountId) {
    const cached = this.sessions.get(id);
    if (cached && Date.now() - cached.at < SESSION_MS) return cached;
    const { user, pass, addresses } = this.login(id);
    let client: Client;
    try {
      client = await createDAVClient({
        serverUrl: SERVER_URL,
        credentials: { username: user, password: pass },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      });
    } catch (err) {
      throw new MailError(502, `iCloud calendar sign-in failed: ${(err as Error).message}`);
    }
    const calendars = (await client.fetchCalendars()).filter((c) => (c.components ?? []).includes("VEVENT"));
    // How you appear in ATTENDEE/ORGANIZER: your addresses (iCloud's own id for you, urn:uuid, is matched by isSelf).
    const self = [...new Set(addresses.map((a) => `mailto:${a}`.toLowerCase()))];
    const session = { client, calendars, self, at: Date.now() };
    this.sessions.set(id, session);
    return session;
  }

  private async calendar(id: AccountId, calendarId: string) {
    const session = await this.session(id);
    const calendar = session.calendars.find((c) => c.url === calendarId);
    if (!calendar) throw new MailError(404, "Calendar not found");
    return { client: session.client, calendar, self: session.self };
  }

  async listCalendars(id: AccountId): Promise<Omit<CalendarInfo, "visible">[]> {
    const { calendars } = await this.session(id);
    return calendars.map((c) => ({
      id: c.url,
      accountId: id,
      name: typeof c.displayName === "string" && c.displayName ? c.displayName : "Calendar",
      color: /^#[0-9a-f]{6}/i.test(c.calendarColor ?? "") ? c.calendarColor!.slice(0, 7).toLowerCase() : paletteColor(c.url),
      readOnly: false,
    }));
  }

  async listEvents(id: AccountId, calendarId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    const { client, calendar, self } = await this.calendar(id, calendarId);
    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: { start: from.toISOString(), end: to.toISOString() },
    });
    return objects.flatMap((object) => {
      try {
        return eventsOf(object, id, calendarId, from, to, self);
      } catch (err) {
        console.warn(`[calendar ${id}] skipped an unreadable event (${object.url}): ${(err as Error).message}`);
        return [];
      }
    });
  }

  async createEvent(id: AccountId, calendarId: string, input: EventInput): Promise<CalendarEvent> {
    const { client, calendar } = await this.calendar(id, calendarId);
    const uid = randomUUID();
    const root = new ICAL.Component(["vcalendar", [], []]);
    root.updatePropertyWithValue("prodid", "-//Open Mail//Calendar//EN");
    root.updatePropertyWithValue("version", "2.0");
    const vevent = new ICAL.Component("vevent");
    vevent.updatePropertyWithValue("uid", uid);
    vevent.updatePropertyWithValue("dtstamp", ICAL.Time.now());
    applyInput(vevent, input);
    root.addSubcomponent(vevent);

    const filename = `${uid}.ics`;
    const res = await client.createCalendarObject({ calendar, filename, iCalString: root.toString() });
    if (!res.ok) throw new MailError(502, `iCloud refused the event (HTTP ${res.status})`);
    const object = { url: new URL(filename, calendar.url).href, data: root.toString() };
    return eventsOf(object, id, calendarId, new Date(0), new Date(8.64e15), [])[0]!;
  }

  async updateEvent(id: AccountId, calendarId: string, eventId: string, input: EventInput): Promise<CalendarEvent> {
    const { client, object, root, vevent } = await this.editable(id, calendarId, eventId);
    // Change the event in place so what the app doesn't show (alarms, extra properties) is kept.
    applyInput(vevent, input);
    const sequence = Number(vevent.getFirstPropertyValue("sequence") ?? 0);
    vevent.updatePropertyWithValue("sequence", sequence + 1);
    vevent.updatePropertyWithValue("dtstamp", ICAL.Time.now());
    vevent.updatePropertyWithValue("last-modified", ICAL.Time.now());
    const data = root.toString();
    const res = await client.updateCalendarObject({ calendarObject: { url: object.url, data, etag: object.etag } });
    if (res.status === 412) throw new MailError(409, "The event changed on another device. Refresh and try again.");
    if (!res.ok) throw new MailError(502, `iCloud refused the change (HTTP ${res.status})`);
    return eventsOf({ url: object.url, data }, id, calendarId, new Date(0), new Date(8.64e15), [])[0]!;
  }

  async deleteEvent(id: AccountId, calendarId: string, eventId: string): Promise<void> {
    const { client, object } = await this.editable(id, calendarId, eventId);
    const res = await client.deleteCalendarObject({ calendarObject: { url: object.url, etag: object.etag } });
    if (res.status === 412) throw new MailError(409, "The event changed on another device. Refresh and try again.");
    if (!res.ok && res.status !== 404) throw new MailError(502, `iCloud refused to delete it (HTTP ${res.status})`);
  }

  /**
   * Answers an invitation: your ATTENDEE's PARTSTAT, in every copy of the event
   * (for a repeating event that's the whole series). iCloud sends the reply to
   * the organizer.
   */
  async respond(id: AccountId, calendarId: string, eventId: string, response: InvitationResponse): Promise<void> {
    const { client, calendar, self } = await this.calendar(id, calendarId);
    const url = eventId.split("#")[0]!;
    if (!url.startsWith(calendar.url)) throw new MailError(404, "Event not found");
    const [object] = await client.fetchCalendarObjects({ calendar, objectUrls: [url] });
    if (!object?.data) throw new MailError(404, "Event not found");
    const root = new ICAL.Component(ICAL.parse(object.data));
    let answered = false;
    for (const vevent of root.getAllSubcomponents("vevent")) {
      for (const attendee of vevent.getAllProperties("attendee")) {
        if (!isSelf(attendee.getFirstValue(), self)) continue;
        attendee.setParameter("partstat", response.toUpperCase());
        attendee.removeParameter("rsvp");
        answered = true;
      }
    }
    if (!answered) throw new MailError(409, "You're not a guest of this event");
    const res = await client.updateCalendarObject({ calendarObject: { url, data: root.toString(), etag: object.etag } });
    if (res.status === 412) throw new MailError(409, "The event changed on another device. Refresh and try again.");
    if (!res.ok) throw new MailError(502, `iCloud refused the answer (HTTP ${res.status})`);
  }

  /** The event's object, if the app may change it (single event without guests). */
  private async editable(id: AccountId, calendarId: string, eventId: string) {
    const { client, calendar } = await this.calendar(id, calendarId);
    if (eventId.includes("#") || !eventId.startsWith(calendar.url)) throw new MailError(409, "Repeating events can't be changed from the app yet");
    const [object] = await client.fetchCalendarObjects({ calendar, objectUrls: [eventId] });
    if (!object?.data) throw new MailError(404, "Event not found");
    const root = new ICAL.Component(ICAL.parse(object.data));
    const vevents = root.getAllSubcomponents("vevent");
    const vevent = vevents.find((v) => !v.hasProperty("recurrence-id")) ?? vevents[0];
    if (!vevent) throw new MailError(404, "Event not found");
    if (vevent.hasProperty("rrule") || vevents.length > 1) throw new MailError(409, "Repeating events can't be changed from the app yet");
    if (vevent.hasProperty("attendee")) throw new MailError(409, "Events with guests can't be changed from the app yet");
    return { client, object, root, vevent };
  }
}

/** You, in an ATTENDEE/ORGANIZER value: one of your addresses, or iCloud's own id for you (urn:uuid). */
function isSelf(value: unknown, self: string[]): boolean {
  const v = String(value ?? "").toLowerCase();
  return self.includes(v) || v.startsWith("urn:uuid:");
}

/** Real alerts (DISPLAY/AUDIO; Apple's ACTION:NONE placeholders aren't), in minutes before the start. */
function alertsOf(vevent: ICAL.Component, start: ICAL.Time, end: ICAL.Time): number[] {
  const minutes: number[] = [];
  for (const alarm of vevent.getAllSubcomponents("valarm")) {
    const action = String(alarm.getFirstPropertyValue("action") ?? "").toUpperCase();
    if (action !== "DISPLAY" && action !== "AUDIO") continue;
    const trigger = alarm.getFirstProperty("trigger");
    const value = trigger?.getFirstValue();
    if (value instanceof ICAL.Duration) {
      const related = String(trigger!.getParameter("related") ?? "START").toUpperCase();
      const fromStart = (related === "END" ? end.toUnixTime() - start.toUnixTime() : 0) + value.toSeconds();
      minutes.push(Math.round(-fromStart / 60));
    } else if (value instanceof ICAL.Time) {
      const before = Math.round((start.toUnixTime() - value.toUnixTime()) / 60);
      // A fixed time only makes sense near this occurrence (repeats reuse the same time).
      if (before > -24 * 60 && before < 14 * 24 * 60) minutes.push(before);
    }
  }
  return [...new Set(minutes)].sort((a, b) => b - a);
}

/** Who invited you and your answer, when you're a guest of someone else's event. */
function invitationOf(vevent: ICAL.Component, self: string[]): CalendarEvent["invitation"] {
  const organizer = vevent.getFirstProperty("organizer");
  if (!organizer || isSelf(organizer.getFirstValue(), self)) return undefined;
  const me = vevent.getAllProperties("attendee").find((a) => isSelf(a.getFirstValue(), self) && !String(a.getFirstValue()).startsWith("urn:"));
  if (!me) return undefined;
  const partstat = String(me.getParameter("partstat") ?? "NEEDS-ACTION").toLowerCase();
  const status: InvitationStatus = partstat === "accepted" || partstat === "tentative" || partstat === "declined" ? partstat : "needs-action";
  const name = organizer.getParameter("cn");
  return { organizer: (typeof name === "string" && name) || String(organizer.getFirstValue()).replace(/^mailto:/i, ""), status };
}

/** The events (or occurrences, for repeats) of one calendar object that fall in [from, to). */
function eventsOf(object: DAVCalendarObject, accountId: AccountId, calendarId: string, from: Date, to: Date, self: string[]): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(object.data));
  // Times with a TZID need their zone known before they're read.
  for (const zone of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(zone);
  const vevents = root.getAllSubcomponents("vevent");
  const master = vevents.find((v) => !v.hasProperty("recurrence-id")) ?? vevents[0];
  if (!master) return [];
  const event = new ICAL.Event(master); // picks up the moved/changed occurrences in the same object
  const hasAttendees = master.hasProperty("attendee");
  const base = { accountId, calendarId, hasAttendees, self };

  if (!event.isRecurring()) {
    return [toEvent(base, object.url, event, event.startDate, event.endDate, false)];
  }
  const rangeStart = ICAL.Time.fromJSDate(from, true);
  const rangeEnd = ICAL.Time.fromJSDate(to, true);
  const events: CalendarEvent[] = [];
  const iterator = event.iterator();
  for (let i = 0, next = iterator.next(); next && i < MAX_OCCURRENCES; i++, next = iterator.next()) {
    if (next.compare(rangeEnd) >= 0) break;
    const details = event.getOccurrenceDetails(next);
    if (details.endDate.compare(rangeStart) <= 0) continue;
    events.push(toEvent(base, `${object.url}#${next.toString()}`, details.item, details.startDate, details.endDate, true));
  }
  return events;
}

function toEvent(
  { self, ...base }: { accountId: AccountId; calendarId: string; hasAttendees: boolean; self: string[] },
  id: string,
  item: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time,
  recurring: boolean,
): CalendarEvent {
  const allDay = start.isDate;
  let endTime = end ?? start;
  if (allDay && endTime.compare(start) <= 0) {
    endTime = start.clone();
    endTime.day += 1; // no DTEND: one day
  }
  return {
    ...base,
    id,
    title: item.summary || "(no title)",
    start: allDay ? start.toString() : start.toJSDate().toISOString(),
    end: allDay ? endTime.toString() : endTime.toJSDate().toISOString(),
    allDay,
    location: item.location ?? "",
    description: item.description ?? "",
    recurring,
    editable: !recurring && !base.hasAttendees,
    alerts: alertsOf(item.component, start, endTime),
    invitation: invitationOf(item.component, self),
  };
}

function setText(vevent: ICAL.Component, name: string, value: string | undefined): void {
  if (value?.trim()) vevent.updatePropertyWithValue(name, value);
  else vevent.removeAllProperties(name);
}

function setTime(vevent: ICAL.Component, name: "dtstart" | "dtend", value: string, allDay: boolean): void {
  vevent.removeAllProperties(name);
  const property = new ICAL.Property(name, vevent);
  if (allDay) {
    property.resetType("date");
    property.setValue(ICAL.Time.fromDateString(value.slice(0, 10)));
  } else {
    property.resetType("date-time");
    property.setValue(ICAL.Time.fromJSDate(new Date(value), true)); // UTC: no time zone definition needed
  }
  vevent.addProperty(property);
}

function applyInput(vevent: ICAL.Component, input: EventInput): void {
  setText(vevent, "summary", input.title.trim() || "(no title)");
  setText(vevent, "location", input.location);
  setText(vevent, "description", input.description);
  setTime(vevent, "dtstart", input.start, input.allDay);
  setTime(vevent, "dtend", input.end, input.allDay);
  vevent.removeAllProperties("duration");
}
