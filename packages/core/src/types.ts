// Shapes shared by the server and the apps. Types only: no Node imports.
import type { HostConfig } from "./presets.js";

export type AccountId = string;
export type AuthType = "password" | "google";

export interface Address {
  name: string;
  address: string;
}

export interface AccountInfo {
  id: AccountId;
  label: string;
  /** The username it signs in with (can differ from `address`, e.g. when the address is an alias). */
  login: string;
  /** Hex color (#rrggbb) shown next to the account's mail. */
  color: string;
  /** HTML signature added to mail sent with `signature: true`. Empty when there is none. */
  signature: string;
  address: string;
  /** Display name used in the From header. */
  name: string;
  /** "env" accounts come from environment variables and can't be edited or removed from the apps. */
  source: "env" | "app";
  authType: AuthType;
  saveSentCopy: boolean;
  imapHost: string;
  calendar: AccountCalendar;
}

/** Calendars the server can reach for an account: iCloud over CalDAV, Gmail over the Google Calendar API. */
export type CalendarProvider = "icloud" | "google";

export interface AccountCalendar {
  /** null: this kind of account has no calendar support (yet). */
  provider: CalendarProvider | null;
  /** The user turned calendars on for this account. */
  enabled: boolean;
  /** The server can sign in: always for iCloud (app password), after "Connect Google Calendar" for Gmail. */
  connected: boolean;
  /** Calendar ids the user hid. */
  hidden: string[];
}

export interface AccountCalendarUpdate {
  enabled?: boolean;
  hidden?: string[];
}

export interface CalendarInfo {
  /** Provider id: the CalDAV collection URL, or the Google calendar id. */
  id: string;
  accountId: AccountId;
  name: string;
  /** Hex color (#rrggbb). */
  color: string;
  /** Events can't be added or changed (shared read-only, holidays…). */
  readOnly: boolean;
  /** Not hidden by the user. */
  visible: boolean;
}

/**
 * One event, or one occurrence of a repeating event. Times: ISO date-times;
 * all-day events use dates (YYYY-MM-DD) with an exclusive end, never shifted by time zone.
 */
export interface CalendarEvent {
  /** Provider id: CalDAV object URL (#occurrence for repeats), or the Google event id. */
  id: string;
  accountId: AccountId;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  /** Part of a repeating series. */
  recurring: boolean;
  /** Has guests (changing it would notify them). */
  hasAttendees: boolean;
  /** Can be changed from the app: a single event, no guests, in a writable calendar. */
  editable: boolean;
  /** Alerts, in minutes before the start (0 = at the start). */
  alerts: number[];
  /** You're a guest (someone else organizes it): who invited you and your answer. */
  invitation?: { organizer: string; status: InvitationStatus };
}

export type InvitationStatus = "needs-action" | "accepted" | "tentative" | "declined";
/** What you can answer to an invitation. */
export type InvitationResponse = "accepted" | "tentative" | "declined";

/** An event alert that is due, as announced to the apps. */
export interface EventReminder {
  event: CalendarEvent;
  minutesBefore: number;
}

/** A new event, or the new values of one (same time conventions as CalendarEvent). */
export interface EventInput {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
}

export interface CalendarPage {
  calendars: CalendarInfo[];
  /** Accounts whose calendars couldn't be read. */
  errors: { accountId: AccountId; error: string }[];
}

export interface EventsPage {
  events: CalendarEvent[];
  errors: { accountId: AccountId; error: string }[];
}

/** A password-based account from the Add Account form (custom servers or a preset). */
export interface AccountInput {
  label?: string;
  color?: string;
  name?: string;
  address: string;
  user?: string; // defaults to the address
  password: string;
  imap: HostConfig;
  smtp: HostConfig;
  saveSentCopy?: boolean;
}

export interface AccountUpdate {
  label?: string;
  color?: string;
  signature?: string;
  name?: string;
  saveSentCopy?: boolean;
}

/** IMAP special-use roles we care about. */
export type FolderRole = "inbox" | "sent" | "drafts" | "trash" | "junk" | "archive" | "all" | "flagged";

export interface Folder {
  path: string;
  name: string;
  role: FolderRole | null;
  total: number | null;
  unread: number | null;
}

/** A label the user can put on messages. */
export interface MailLabel {
  id: string;
  name: string;
  /** Hex color (#rrggbb). */
  color: string;
}

export interface MessageHeader {
  accountId: AccountId;
  folder: string;
  uid: number;
  messageId?: string;
  from: Address;
  to: Address[];
  subject: string;
  date: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  /** Ids of the MailLabels on this message. */
  labels: string[];
  hasAttachments: boolean;
  size: number;
  /**
   * Conversation id, unique within an account: the server's thread id (Gmail,
   * OBJECTID servers) or else the first Message-ID of the References chain.
   */
  threadId?: string;
}

/** A message that just arrived in an inbox, as announced to the apps. */
export interface NewMail {
  message: MessageHeader;
  /** The start of the text, for a notification. */
  preview: string;
}

export interface MessagePage {
  messages: MessageHeader[];
  /** Total matching messages (folder size, or number of search hits). */
  total: number;
  /** Per-account failures when listing several accounts at once. */
  errors?: { accountId: AccountId; error: string }[];
}

export interface AttachmentInfo {
  index: number;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
}

export interface MailMessage extends MessageHeader {
  cc: Address[];
  replyTo: Address[];
  references: string[];
  text: string;
  html: string | null;
  attachments: AttachmentInfo[];
}

export interface OutgoingAttachment {
  filename: string;
  contentType?: string;
  /** Base64-encoded file content. */
  content: string;
}

export interface OutgoingMail {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: OutgoingAttachment[];
  /** Add the account's signature when the mail goes out (also for scheduled mail). */
  signature?: boolean;
  /** In replies and forwards: above the quoted message (default) or at the very end. */
  signaturePosition?: "before-quote" | "end";
  /** Add an open-tracking pixel (see TrackingStore). */
  track?: boolean;
  /** Set by the server for tracked mail, to match the sent copy with its opens. */
  messageId?: string;
}

/** How often a tracked message was opened (approximate: see TrackingStore). */
export interface TrackingSummary {
  /** The sent message's Message-ID. */
  messageId: string;
  opens: number;
  firstOpen: string | null;
  lastOpen: string | null;
  /** Some opens look like Apple Mail's automatic image loading. */
  appleProxy: boolean;
  /** Each open, newest first (older servers: absent). */
  events?: TrackingOpen[];
}

/** One load of the tracking pixel. */
export interface TrackingOpen {
  at: string;
  /** The mail app that loaded it, as far as its user agent tells: "Outlook 16", "Gmail", "Chrome"… */
  client: string;
  /** The system it runs on, when the user agent says: "Windows", "iPhone", "macOS"… */
  device?: string;
  /** Address the image was fetched from. For proxied opens, it's the mail provider's, not the reader's. */
  ip?: string;
  /**
   * Fetched by the mail provider on the reader's behalf (Gmail, Apple Mail Privacy
   * Protection, Yahoo): the ip and device say nothing about the reader, and with
   * Apple it may not even mean the message was read.
   */
  proxied: boolean;
  /** The raw user agent, for anything the summary above missed. */
  agent?: string;
}

export type ScheduleStatus = "pending" | "sending" | "sent" | "failed";

export interface ScheduledMail extends OutgoingMail {
  id: string;
  accountId: AccountId;
  /** ISO timestamp. */
  sendAt: string;
  status: ScheduleStatus;
  attempts: number;
  /** When a failed attempt will be retried. */
  retryAt?: string;
  error?: string;
  sentAt?: string;
  messageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SendResult {
  messageId: string;
}
