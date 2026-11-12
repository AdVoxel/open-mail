// Calendars of every account that has them, behind one interface: iCloud over
// CalDAV, Gmail over the Google Calendar API.
import { ICloudCalendars } from "./calendar-icloud.js";
import { GoogleCalendars } from "./calendar-google.js";
import type { ConfigStore } from "./config.js";
import { GOOGLE_CALENDAR_SCOPES, signInWithGoogle, type GoogleClientSource } from "./google-oauth.js";
import { describe, MailError, type MailService } from "./mail.js";
import type {
  AccountCalendarUpdate,
  AccountId,
  AccountInfo,
  CalendarEvent,
  CalendarInfo,
  CalendarPage,
  EventInput,
  EventsPage,
  InvitationResponse,
} from "./types.js";

/** Longest range of events fetched at once. */
const MAX_RANGE_MS = 100 * 24 * 60 * 60_000;

export class CalendarService {
  private icloud: ICloudCalendars;
  private google: GoogleCalendars;

  constructor(
    private mail: MailService,
    private store: ConfigStore | undefined,
    private googleClient: GoogleClientSource = () => undefined,
  ) {
    this.icloud = new ICloudCalendars((id) => {
      const account = this.account(id);
      return { ...mail.passwordLogin(id), addresses: [account.address, account.login] };
    });
    this.google = new GoogleCalendars(googleClient, (id) => {
      const stored = store?.accounts().find((a) => a.id === id);
      return stored ? store!.calendarToken(stored) : null;
    });
  }

  /** "Connect Google Calendar" is possible (the server has a Google OAuth client). */
  get canConnectGoogle(): boolean {
    return this.store !== undefined && this.googleClient() !== undefined;
  }

  private account(id: AccountId): AccountInfo {
    const account = this.mail.listAccounts().find((a) => a.id === id);
    if (!account) throw new MailError(404, `Account "${id}" is not configured`);
    return account;
  }

  private provider(account: AccountInfo) {
    if (!account.calendar.connected) throw new MailError(409, "This account's calendar isn't connected");
    if (account.calendar.provider === "icloud") return this.icloud;
    if (account.calendar.provider === "google") return this.google;
    throw new MailError(409, "This account has no calendar the app can reach");
  }

  private requireStore(): ConfigStore {
    if (!this.store) throw new MailError(501, "Calendar settings need the account store");
    return this.store;
  }

  /** Accounts with calendars turned on. */
  private enabledAccounts(): AccountInfo[] {
    return this.mail.listAccounts().filter((a) => a.calendar.enabled);
  }

  async listCalendars(): Promise<CalendarPage> {
    const page: CalendarPage = { calendars: [], errors: [] };
    await Promise.all(
      this.enabledAccounts().map(async (account) => {
        try {
          const list = await this.provider(account).listCalendars(account.id);
          page.calendars.push(...list.map((c) => ({ ...c, visible: !account.calendar.hidden.includes(c.id) })));
        } catch (err) {
          page.errors.push({ accountId: account.id, error: describe(err) });
        }
      }),
    );
    return page;
  }

  /** Events of the visible calendars in [from, to), sorted by start. */
  async listEvents(from: Date, to: Date): Promise<EventsPage> {
    if (!(to > from)) throw new MailError(400, "The range must end after it starts");
    if (+to - +from > MAX_RANGE_MS) throw new MailError(400, "Ask for at most 100 days at a time");
    const page: EventsPage = { events: [], errors: [] };
    await Promise.all(
      this.enabledAccounts().map(async (account) => {
        try {
          const provider = this.provider(account);
          const calendars = (await provider.listCalendars(account.id)).filter((c) => !account.calendar.hidden.includes(c.id));
          const lists = await Promise.all(calendars.map((c) => provider.listEvents(account.id, c.id, from, to)));
          page.events.push(...lists.flat());
        } catch (err) {
          page.errors.push({ accountId: account.id, error: describe(err) });
        }
      }),
    );
    page.events.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return page;
  }

  async createEvent(accountId: AccountId, calendarId: string, input: EventInput): Promise<CalendarEvent> {
    checkInput(input);
    return this.provider(this.account(accountId)).createEvent(accountId, calendarId, input);
  }

  async updateEvent(accountId: AccountId, calendarId: string, eventId: string, input: EventInput): Promise<CalendarEvent> {
    checkInput(input);
    return this.provider(this.account(accountId)).updateEvent(accountId, calendarId, eventId, input);
  }

  async deleteEvent(accountId: AccountId, calendarId: string, eventId: string): Promise<void> {
    await this.provider(this.account(accountId)).deleteEvent(accountId, calendarId, eventId);
  }

  /** Answers an invitation (the provider tells the organizer). */
  async respond(accountId: AccountId, calendarId: string, eventId: string, response: InvitationResponse): Promise<void> {
    await this.provider(this.account(accountId)).respond(accountId, calendarId, eventId, response);
  }

  updateSettings(accountId: AccountId, update: AccountCalendarUpdate): AccountInfo {
    const account = this.account(accountId);
    if (account.source !== "app") throw new MailError(409, "Calendar settings are only available for accounts added in the app");
    if (update.enabled && !account.calendar.connected) throw new MailError(409, "Connect this account's calendar first");
    this.requireStore().updateCalendar(accountId, update);
    return this.account(accountId);
  }

  /** Google sign-in for calendar access on a Gmail account (its mail keeps using the app password). */
  async connectGoogle(accountId: AccountId, openUrl: (url: string) => Promise<void> | void): Promise<AccountInfo> {
    const account = this.account(accountId);
    if (account.calendar.provider !== "google") throw new MailError(409, "Only Gmail accounts connect to Google Calendar");
    const client = this.googleClient();
    if (!client) throw new MailError(501, "Google sign-in isn't set up: add the OAuth client in Settings");
    const store = this.requireStore();
    const { email, refreshToken } = await signInWithGoogle(client, openUrl, GOOGLE_CALENDAR_SCOPES);
    // The Google account can be the mailbox's login while the address is an alias of it.
    const allowed = [...new Set([account.login, account.address].map((a) => a.toLowerCase()))];
    if (!allowed.includes(email.toLowerCase())) {
      throw new MailError(400, `Signed in as ${email}; sign in as ${allowed.join(" or ")} to connect this account's calendar`);
    }
    store.setCalendarToken(accountId, refreshToken);
    store.updateCalendar(accountId, { enabled: true });
    this.google.forget(accountId);
    return this.account(accountId);
  }

  disconnectGoogle(accountId: AccountId): AccountInfo {
    this.requireStore().setCalendarToken(accountId, null);
    this.google.forget(accountId);
    return this.account(accountId);
  }
}

/** All-day dates and date-times sort together by their UTC start. */
function sortKey(e: CalendarEvent): string {
  return e.allDay ? `${e.start}T00:00:00.000Z` : e.start;
}

function checkInput(input: EventInput): void {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (input.allDay) {
    if (!date.test(input.start) || !date.test(input.end)) throw new MailError(400, "All-day events take dates (YYYY-MM-DD)");
    if (!(input.end > input.start)) throw new MailError(400, "The end must be after the start (all-day ends are exclusive)");
  } else {
    const start = Date.parse(input.start);
    const end = Date.parse(input.end);
    if (Number.isNaN(start) || Number.isNaN(end)) throw new MailError(400, "Start and end must be dates with times");
    if (end < start) throw new MailError(400, "The end must not be before the start");
  }
}
