// Fires calendar alerts: tells listeners (the server's event stream) when an
// event's alert is due, so the apps can show a notification.
import { EventEmitter } from "node:events";
import type { CalendarService } from "./calendar.js";
import { describe } from "./mail.js";
import type { CalendarEvent, EventReminder } from "./types.js";

const LOOK_BEHIND_MS = 60 * 60_000;
/** Far enough ahead for "1 week before" alerts on the events fetched. */
const LOOK_AHEAD_MS = 8 * 24 * 60 * 60_000;

/** When the event starts, on the server's clock (all-day events: local midnight). */
function startMs(event: CalendarEvent): number {
  if (!event.allDay) return Date.parse(event.start);
  const [y, m, d] = event.start.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
}

export class EventReminders extends EventEmitter<{ reminder: [EventReminder] }> {
  private events: CalendarEvent[] = [];
  private fetchedAt = 0;
  private lastCheck = Date.now(); // alerts due before the server started aren't replayed
  private fired = new Set<string>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private calendars: CalendarService,
    private intervalMs = 30_000,
    private refreshMs = 5 * 60_000,
  ) {
    super();
    this.setMaxListeners(100);
  }

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), this.intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Fetch the events again on the next check (after one was added or changed). */
  invalidate(): void {
    this.fetchedAt = 0;
  }

  private async check(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      if (now - this.fetchedAt > this.refreshMs) {
        try {
          const page = await this.calendars.listEvents(new Date(now - LOOK_BEHIND_MS), new Date(now + LOOK_AHEAD_MS));
          this.events = page.events;
          this.fetchedAt = now;
        } catch (err) {
          console.warn(`[reminders] couldn't read the calendars: ${describe(err)}`);
        }
      }
      for (const event of this.events) {
        if (event.invitation?.status === "declined") continue;
        for (const minutesBefore of event.alerts) {
          const due = startMs(event) - minutesBefore * 60_000;
          const key = `${event.accountId}\n${event.calendarId}\n${event.id}\n${due}`;
          if (due > this.lastCheck && due <= now && !this.fired.has(key)) {
            this.fired.add(key);
            this.emit("reminder", { event, minutesBefore });
          }
        }
      }
      this.lastCheck = now;
      if (this.fired.size > 10_000) this.fired.clear();
    } finally {
      this.running = false;
    }
  }
}
