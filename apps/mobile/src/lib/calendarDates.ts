// Local-calendar date helpers. Days are "YYYY-MM-DD" in the device's time zone;
// all-day events keep their dates as they are (never through Date/UTC).
import type { CalendarEvent } from "@mail-app/api-client";

const pad = (n: number) => String(n).padStart(2, "0");

/** The local day of a Date, as YYYY-MM-DD. */
export function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of a YYYY-MM-DD day. */
export function dayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function addDays(day: string, days: number): string {
  const date = dayStart(day);
  date.setDate(date.getDate() + days);
  return ymd(date);
}

/** Local HH:MM of a date-time. */
export function hm(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** ISO date-time from a local day and HH:MM. */
export function localDateTime(day: string, time: string): string {
  const [h, min] = time.split(":").map(Number) as [number, number];
  const date = dayStart(day);
  date.setHours(h || 0, min || 0, 0, 0);
  return date.toISOString();
}

/** The 6 weeks (Monday first) shown for the month containing `month`. */
export function monthGrid(month: Date): string[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // days since Monday
  const start = ymd(new Date(first.getFullYear(), first.getMonth(), 1 - offset));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** The local days an event covers (all-day ends are exclusive; a timed event ending at midnight doesn't cover the next day). */
export function eventDays(event: CalendarEvent): string[] {
  let first: string;
  let last: string;
  if (event.allDay) {
    first = event.start;
    last = addDays(event.end, -1);
  } else {
    const start = new Date(event.start);
    const end = new Date(Math.max(Date.parse(event.end) - 1, start.getTime()));
    first = ymd(start);
    last = ymd(end);
  }
  const days: string[] = [];
  for (let day = first; day <= last && days.length < 366; day = addDays(day, 1)) days.push(day);
  return days.length ? days : [first];
}

export function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${time(event.start)} – ${time(event.end)}`;
}

/** The event being opened in the editor (it isn't refetched by id). */
export const openedEvents = new Map<string, CalendarEvent>();

export function eventKey(event: Pick<CalendarEvent, "accountId" | "calendarId" | "id">): string {
  return `${event.accountId}\n${event.calendarId}\n${event.id}`;
}
