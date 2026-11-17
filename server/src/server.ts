import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  describe,
  MailError,
  type AccountInfo,
  type BlockList,
  type CalendarService,
  type ContactService,
  type EventReminder,
  type EventReminders,
  type LockService,
  type LabelStore,
  type MailService,
  type NewMail,
  type NewMailWatcher,
  type Scheduler,
  type TrackingStore,
  TRACKING_GIF,
} from "@mail-app/core";

export interface ServerOptions {
  port: number;
  host: string;
  token: string;
  mail: MailService;
  scheduler: Scheduler;
  labels: LabelStore;
  blocklist: BlockList;
  watcher: NewMailWatcher;
  reminders: EventReminders;
  calendars: CalendarService;
  contacts: ContactService;
  lock: LockService;
  googleClient: GoogleClientSettings;
  tracking: TrackingStore;
  /** Where recipients reach this server (for the tracking pixel); else taken from the request. */
  publicUrl?: string;
  /** Where the web app runs (e.g. https://mail.advoxel.com): pixel loads from its pages aren't opens. */
  appOrigins?: string[];
  version?: string;
}

export interface GoogleClientStatus {
  configured: boolean;
  /** "environment": GOOGLE_CLIENT_ID/SECRET (can't be changed from the apps); "app": saved from Settings. */
  source: "environment" | "app" | null;
  /** Not secret; shown so you can tell which client is in use. */
  clientId: string | null;
}

/** The Google OAuth client, settable from the apps' Settings. */
export interface GoogleClientSettings {
  status: () => GoogleClientStatus;
  /** Checks the client with Google, then saves it (secret encrypted). */
  save: (client: { clientId: string; clientSecret: string }) => Promise<void>;
  remove: () => void;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A handler may return this to send raw bytes (attachments) instead of JSON. */
class FileResponse {
  constructor(
    public filename: string,
    public contentType: string,
    public content: Buffer,
  ) {}
}

const HostSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
});

const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a color like #2563eb");

const AccountInputSchema = z.object({
  label: z.string().optional(),
  color: ColorSchema.optional(),
  name: z.string().optional(),
  address: z.string().trim().min(3),
  user: z.string().optional(),
  password: z.string().min(1),
  imap: HostSchema,
  smtp: HostSchema,
  saveSentCopy: z.boolean().optional(),
  importContacts: z.boolean().optional(),
});

const AccountUpdateSchema = z.object({
  label: z.string().trim().min(1).optional(),
  color: ColorSchema.optional(),
  signature: z.string().max(100_000).optional(),
  name: z.string().trim().optional(),
  saveSentCopy: z.boolean().optional(),
  importContacts: z.boolean().optional(),
});

const MailSchema = z.object({
  to: z.string().trim().min(1, "Add at least one recipient"),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string(),
  text: z.string(),
  html: z.string().optional(),
  signature: z.boolean().optional(),
  signaturePosition: z.enum(["before-quote", "end"]).optional(),
  track: z.boolean().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
  attachments: z
    .array(z.object({ filename: z.string().min(1), contentType: z.string().optional(), content: z.base64() }))
    .optional(),
});

const SendSchema = MailSchema.extend({
  /** Optional ISO date. In the future = schedule it; otherwise send now. */
  sendAt: z.iso.datetime({ offset: true }).optional(),
});

/** A draft can be saved before it has recipients. */
const DraftSchema = MailSchema.extend({
  to: z.string(),
  replace: z.object({ folder: z.string().min(1), uid: z.number().int().positive() }).optional(),
});

const ScheduleSchema = MailSchema.extend({
  accountId: z.string().min(1),
  sendAt: z.iso.datetime({ offset: true }),
});

const ScheduleUpdateSchema = MailSchema.partial().extend({
  accountId: z.string().min(1).optional(),
  sendAt: z.iso.datetime({ offset: true }).optional(),
});

const BlockInputSchema = z.object({
  kind: z.enum(["address", "domain", "regex"]),
  value: z.string().trim().min(1).max(300),
});
const SpamSchema = z.object({ block: BlockInputSchema.optional() });

const LabelIdSchema = z.string().regex(/^[0-9a-f]{8}$/, "Unknown label id");

const FlagsSchema = z.object({
  seen: z.boolean().optional(),
  flagged: z.boolean().optional(),
  answered: z.boolean().optional(),
  /** label id → true to add the label, false to remove it */
  labels: z.record(LabelIdSchema, z.boolean()).optional(),
});

const LabelSchema = z.object({
  name: z.string().trim().min(1, "Give the label a name").max(60),
  color: ColorSchema,
});

const CalendarSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  hidden: z.array(z.string()).max(500).optional(),
});

const EventInputSchema = z.object({
  title: z.string().max(1000),
  start: z.string().min(10).max(40),
  end: z.string().min(10).max(40),
  allDay: z.boolean(),
  location: z.string().max(2000).optional(),
  description: z.string().max(50_000).optional(),
  guests: z.array(z.string().trim().min(3).max(320)).max(200).optional(),
});

const ContactUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(500),
  organization: z.string().max(500),
  emails: z.array(z.string().max(320)).max(50),
  phones: z.array(z.string().max(60)).max(50),
});

const EventTargetSchema = z.object({ accountId: z.string().min(1), calendarId: z.string().min(1) });
const RespondSchema = EventTargetSchema.extend({ eventId: z.string().min(1), response: z.enum(["accepted", "tentative", "declined"]) });
const NewEventSchema = EventInputSchema.extend(EventTargetSchema.shape);
const EventUpdateSchema = NewEventSchema.extend({ eventId: z.string().min(1) });

const GoogleClientSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(/^[\w.-]+\.apps\.googleusercontent\.com$/, "The client ID ends in .apps.googleusercontent.com"),
  clientSecret: z.string().trim().min(10, "Paste the whole client secret").max(200),
});

const PasswordSchema = z.object({ password: z.string().min(1).max(200) });
const SetPasswordSchema = PasswordSchema.extend({ currentPassword: z.string().max(200).optional() });
const ResetRequestSchema = z.object({ accountId: z.string().min(1) });
const ResetConfirmSchema = PasswordSchema.extend({ code: z.string().min(1).max(12) });

const MoveSchema = z.object({
  /** A folder path, or "inbox" | "archive" | "trash" | "junk". */
  to: z.string().min(1),
});

type Params = Record<string, string>;
type OutgoingMailBody = z.infer<typeof MailSchema>;
type Handler = (req: IncomingMessage, params: Params, url: URL) => Promise<unknown> | unknown;

interface GoogleSession {
  status: "pending" | "done" | "error";
  account?: AccountInfo;
  error?: string;
}

/**
 * The mail API used by the desktop and mobile apps. Every request except
 * /api/health needs `Authorization: Bearer <token>`; mail passwords never
 * leave this process.
 */
export function startServer({
  port,
  host,
  token,
  mail,
  scheduler,
  labels,
  blocklist,
  watcher,
  reminders,
  calendars,
  contacts,
  lock,
  googleClient,
  tracking,
  publicUrl,
  appOrigins = [],
  version = "dev",
}: ServerOptions): Server {
  /** The address recipients use to reach this server: MAIL_APP_PUBLIC_URL, else what the app called (behind a proxy too). */
  function publicBase(req: IncomingMessage): string {
    if (publicUrl) return publicUrl;
    const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0]!.trim();
    const hostHeader = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${port}`).split(",")[0]!.trim();
    return `${proto}://${hostHeader}`;
  }

  /** Tracked mail gets its pixel (and own Message-ID) before it's sent or scheduled. */
  function withTracking<T extends OutgoingMailBody>(req: IncomingMessage, accountId: string, outgoing: T): T {
    if (!outgoing.track) return outgoing;
    const account = mail.listAccounts().find((a) => a.id === accountId);
    return { ...outgoing, ...tracking.track(accountId, account?.address ?? "", outgoing, publicBase(req)), track: false };
  }

  if (!token) throw new Error("MAIL_APP_TOKEN is required");
  const expected = Buffer.from(`Bearer ${token}`);
  const googleSessions = new Map<string, GoogleSession>();

  function requireAccount(params: Params): string {
    if (!mail.hasAccount(params.id!)) throw new HttpError(404, `Account "${params.id}" is not configured`);
    return params.id!;
  }

  function folderParam(url: URL): string {
    return url.searchParams.get("folder") || "INBOX";
  }

  function uidParam(params: Params): number {
    const uid = Number(params.uid);
    if (!Number.isInteger(uid) || uid < 1) throw new HttpError(400, "Invalid message uid");
    return uid;
  }

  function intParam(url: URL, name: string, fallback: number, max: number): number {
    const value = Number(url.searchParams.get(name));
    return Number.isInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
  }

  const routes: [method: string, pattern: string, handler: Handler][] = [
    [
      "GET",
      "/api/capabilities",
      () => ({ version, manageAccounts: mail.canManageAccounts, googleSignIn: mail.canSignInWithGoogle, googleCalendar: calendars.canConnectGoogle }),
    ],

    // Accounts
    ["GET", "/api/accounts", () => mail.listAccounts()],
    [
      "POST",
      "/api/accounts/test",
      async (req) => {
        const input = parse(AccountInputSchema, await readJson(req));
        await mail.testConnection(input, { user: input.user?.trim() || input.address, pass: input.password });
        return { ok: true };
      },
    ],
    [
      "POST",
      "/api/accounts",
      async (req) => {
        const account = await mail.addAccount(parse(AccountInputSchema, await readJson(req)));
        void contacts.refresh(); // an iCloud account brings its contacts
        return account;
      },
    ],
    [
      "PATCH",
      "/api/accounts/:id",
      async (req, params) => {
        const update = parse(AccountUpdateSchema, await readJson(req));
        const account = mail.updateAccount(requireAccount(params), update);
        if (update.importContacts !== undefined) void contacts.refresh(); // import (or drop) its contacts now
        return account;
      },
    ],
    [
      "DELETE",
      "/api/accounts/:id",
      async (_req, params) => {
        await mail.removeAccount(requireAccount(params));
        return { ok: true };
      },
    ],

    // Google sign-in: the app opens `url` in a browser, then polls the session.
    [
      "POST",
      "/api/accounts/google",
      async () => {
        if (!mail.canSignInWithGoogle) throw new HttpError(501, "Google sign-in is not configured on the server");
        const id = randomUUID();
        const session: GoogleSession = { status: "pending" };
        googleSessions.set(id, session);
        const url = await new Promise<string>((resolve, reject) => {
          mail
            .addGoogleAccount((authUrl) => resolve(authUrl))
            .then((account) => Object.assign(session, { status: "done", account }))
            .catch((err: unknown) => {
              Object.assign(session, { status: "error", error: describe(err) });
              reject(err);
            })
            .finally(() => setTimeout(() => googleSessions.delete(id), 10 * 60_000).unref());
        });
        return { sessionId: id, url };
      },
    ],
    [
      "GET",
      "/api/accounts/google/:session",
      (_req, params) => {
        const session = googleSessions.get(params.session!);
        if (!session) throw new HttpError(404, "Sign-in session not found or expired");
        return session;
      },
    ],

    // Folders and messages
    ["GET", "/api/accounts/:id/folders", (_req, params, url) => mail.listFolders(requireAccount(params), { fresh: url.searchParams.has("fresh") })],
    [
      "GET",
      "/api/messages",
      // ?mailbox=sent: every account's Sent folder instead of the inboxes.
      (_req, _params, url) =>
        mail.listAll(url.searchParams.get("mailbox") === "sent" ? "sent" : "inbox", intParam(url, "limit", 50, 200), url.searchParams.get("unread") === "1"),
    ],
    [
      "GET",
      "/api/accounts/:id/messages",
      (_req, params, url) =>
        mail.listMessages(requireAccount(params), {
          folder: folderParam(url),
          limit: intParam(url, "limit", 50, 200) || 50,
          offset: intParam(url, "offset", 0, Number.MAX_SAFE_INTEGER),
          query: url.searchParams.get("q") ?? undefined,
          unread: url.searchParams.get("unread") === "1",
        }),
    ],
    [
      "GET",
      "/api/accounts/:id/messages/:uid",
      (_req, params, url) => mail.getMessage(requireAccount(params), folderParam(url), uidParam(params)),
    ],
    [
      "GET",
      "/api/accounts/:id/messages/:uid/thread",
      (_req, params, url) => mail.getThread(requireAccount(params), folderParam(url), uidParam(params)),
    ],
    [
      "GET",
      "/api/accounts/:id/messages/:uid/attachments",
      async (_req, params, url) => {
        const file = await mail.getAttachmentsZip(requireAccount(params), folderParam(url), uidParam(params));
        return new FileResponse(file.filename, file.contentType, file.content);
      },
    ],
    [
      "GET",
      "/api/accounts/:id/messages/:uid/attachments/:index",
      async (_req, params, url) => {
        const index = Number(params.index);
        if (!Number.isInteger(index) || index < 0) throw new HttpError(400, "Invalid attachment index");
        const file = await mail.getAttachment(requireAccount(params), folderParam(url), uidParam(params), index);
        return new FileResponse(file.filename, file.contentType, file.content);
      },
    ],
    [
      "PATCH",
      "/api/accounts/:id/messages/:uid",
      async (req, params, url) => {
        await mail.setFlags(requireAccount(params), folderParam(url), uidParam(params), parse(FlagsSchema, await readJson(req)));
        return { ok: true };
      },
    ],
    [
      "POST",
      "/api/accounts/:id/messages/:uid/move",
      async (req, params, url) => {
        const { to } = parse(MoveSchema, await readJson(req));
        return mail.moveMessage(requireAccount(params), folderParam(url), uidParam(params), to);
      },
    ],
    // Spam: to the account's spam folder, optionally blocking the sender from then on.
    [
      "POST",
      "/api/accounts/:id/messages/:uid/spam",
      async (req, params, url) => {
        const { block } = parse(SpamSchema, await readJson(req));
        const rule = block ? blocklist.add(block) : undefined; // first: a bad regex refuses before anything moves
        const moved = await mail.moveToSpam(requireAccount(params), folderParam(url), uidParam(params));
        return { ...moved, rule };
      },
    ],
    [
      "DELETE",
      "/api/accounts/:id/messages/:uid",
      (_req, params, url) => mail.deleteMessage(requireAccount(params), folderParam(url), uidParam(params)),
    ],

    // Sending
    [
      "POST",
      "/api/accounts/:id/send",
      async (req, params) => {
        const accountId = requireAccount(params);
        const { sendAt, ...requested } = parse(SendSchema, await readJson(req));
        const outgoing = withTracking(req, params.id!, requested);
        if (sendAt && Date.parse(sendAt) > Date.now() + 5_000) {
          return { scheduled: scheduler.create(accountId, outgoing, new Date(sendAt)) };
        }
        return { sent: await mail.send(accountId, outgoing) };
      },
    ],

    // Scheduled mail
    // Google OAuth client (for Google sign-in and Google Calendar)
    ["GET", "/api/google-client", () => googleClient.status()],
    [
      "PUT",
      "/api/google-client",
      async (req) => {
        await googleClient.save(parse(GoogleClientSchema, await readJson(req)));
        return googleClient.status();
      },
    ],
    [
      "DELETE",
      "/api/google-client",
      () => {
        googleClient.remove();
        return googleClient.status();
      },
    ],

    // Screen lock
    ["GET", "/api/lock", () => ({ enabled: lock.enabled })],
    [
      "PUT",
      "/api/lock",
      async (req) => {
        const { password, currentPassword } = parse(SetPasswordSchema, await readJson(req));
        await lock.set(password, currentPassword);
        return { enabled: true };
      },
    ],
    [
      "DELETE",
      "/api/lock",
      async (req) => {
        await lock.disable(parse(PasswordSchema, await readJson(req)).password);
        return { enabled: false };
      },
    ],
    [
      "POST",
      "/api/lock/unlock",
      async (req) => {
        await lock.check(parse(PasswordSchema, await readJson(req)).password);
        return { ok: true };
      },
    ],
    [
      "POST",
      "/api/lock/reset",
      async (req) => {
        const { accountId } = parse(ResetRequestSchema, await readJson(req));
        return { sentTo: await lock.requestReset(requireAccount({ id: accountId })) };
      },
    ],
    [
      "POST",
      "/api/lock/reset/confirm",
      async (req) => {
        const { code, password } = parse(ResetConfirmSchema, await readJson(req));
        lock.confirmReset(code, password);
        return { ok: true };
      },
    ],

    // Blocked senders
    ["GET", "/api/blocklist", () => blocklist.list()],
    ["POST", "/api/blocklist", async (req) => blocklist.add(parse(BlockInputSchema, await readJson(req)))],
    [
      "DELETE",
      "/api/blocklist/:bid",
      (_req, params) => {
        blocklist.remove(params.bid!);
        return { ok: true };
      },
    ],

    // Calendars
    ["GET", "/api/calendars", () => calendars.listCalendars()],
    [
      "PATCH",
      "/api/accounts/:id/calendar",
      async (req, params) => calendars.updateSettings(requireAccount(params), parse(CalendarSettingsSchema, await readJson(req))),
    ],
    [
      "POST",
      "/api/accounts/:id/calendar/google",
      async (_req, params) => {
        const accountId = requireAccount(params);
        if (!calendars.canConnectGoogle) throw new HttpError(501, "Google sign-in is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
        const id = randomUUID();
        const session: GoogleSession = { status: "pending" };
        googleSessions.set(id, session);
        const url = await new Promise<string>((resolve, reject) => {
          calendars
            .connectGoogle(accountId, (authUrl) => resolve(authUrl))
            .then((account) => {
              Object.assign(session, { status: "done", account });
              void contacts.refresh(); // the same sign-in gives contacts
            })
            .catch((err: unknown) => {
              Object.assign(session, { status: "error", error: describe(err) });
              reject(err);
            })
            .finally(() => setTimeout(() => googleSessions.delete(id), 10 * 60_000).unref());
        });
        return { sessionId: id, url };
      },
    ],
    [
      "DELETE",
      "/api/accounts/:id/calendar/google",
      (_req, params) => {
        const account = calendars.disconnectGoogle(requireAccount(params));
        void contacts.refresh();
        return account;
      },
    ],

    // Contacts (imported from the accounts on their own; refresh to import now)
    ["GET", "/api/contacts", () => contacts.list()],
    [
      "PATCH",
      "/api/contacts",
      async (req) => {
        const { id, ...update } = parse(ContactUpdateSchema, await readJson(req));
        return contacts.update(id, update);
      },
    ],
    [
      "POST",
      "/api/contacts/refresh",
      async () => {
        await contacts.refresh();
        return contacts.list();
      },
    ],
    [
      "POST",
      "/api/calendar/events/respond",
      async (req) => {
        const { accountId, calendarId, eventId, response } = parse(RespondSchema, await readJson(req));
        requireAccount({ id: accountId });
        await calendars.respond(accountId, calendarId, eventId, response);
        reminders.invalidate();
        return { ok: true };
      },
    ],
    [
      "GET",
      "/api/calendar/events",
      (_req, _params, url) => {
        const from = new Date(url.searchParams.get("from") ?? "");
        const to = new Date(url.searchParams.get("to") ?? "");
        if (Number.isNaN(+from) || Number.isNaN(+to)) throw new HttpError(400, "Pass from and to as ISO dates");
        return calendars.listEvents(from, to);
      },
    ],
    [
      "POST",
      "/api/calendar/events",
      async (req) => {
        const { accountId, calendarId, ...input } = parse(NewEventSchema, await readJson(req));
        requireAccount({ id: accountId });
        const event = await calendars.createEvent(accountId, calendarId, input);
        reminders.invalidate();
        return event;
      },
    ],
    [
      "PATCH",
      "/api/calendar/events",
      async (req) => {
        const { accountId, calendarId, eventId, ...input } = parse(EventUpdateSchema, await readJson(req));
        requireAccount({ id: accountId });
        const event = await calendars.updateEvent(accountId, calendarId, eventId, input);
        reminders.invalidate();
        return event;
      },
    ],
    [
      "DELETE",
      "/api/calendar/events",
      async (_req, _params, url) => {
        const accountId = url.searchParams.get("accountId") ?? "";
        const calendarId = url.searchParams.get("calendarId") ?? "";
        const eventId = url.searchParams.get("eventId") ?? "";
        if (!calendarId || !eventId) throw new HttpError(400, "Pass accountId, calendarId and eventId");
        requireAccount({ id: accountId });
        await calendars.deleteEvent(accountId, calendarId, eventId);
        reminders.invalidate();
        return { ok: true };
      },
    ],

    // Open tracking: ?messageId= for one message, else every tracked one.
    ["GET", "/api/tracking", (_req, _params, url) => tracking.summaries(url.searchParams.getAll("messageId").filter(Boolean).length ? url.searchParams.getAll("messageId") : undefined)],

    // Labels
    ["GET", "/api/labels", () => labels.list()],
    [
      "POST",
      "/api/labels",
      async (req) => {
        const { name, color } = parse(LabelSchema, await readJson(req));
        return labels.add(name, color);
      },
    ],
    [
      "PATCH",
      "/api/labels/:lid",
      async (req, params) => {
        if (!labels.list().some((l) => l.id === params.lid)) throw new HttpError(404, "Label not found");
        return labels.update(params.lid!, parse(LabelSchema.partial(), await readJson(req)));
      },
    ],
    [
      "DELETE",
      "/api/labels/:lid",
      (_req, params) => {
        labels.remove(params.lid!);
        return { ok: true };
      },
    ],

    // Drafts
    [
      "POST",
      "/api/accounts/:id/drafts",
      async (req, params) => {
        const { replace, ...mailFields } = parse(DraftSchema, await readJson(req));
        return mail.saveDraft(requireAccount(params), mailFields, replace);
      },
    ],
    [
      "DELETE",
      "/api/accounts/:id/drafts/:uid",
      async (_req, params, url) => {
        await mail.discardDraft(requireAccount(params), folderParam(url), uidParam(params));
        return { ok: true };
      },
    ],

    // Scheduled mail
    ["GET", "/api/scheduled", () => scheduler.list()],
    [
      "POST",
      "/api/scheduled",
      async (req) => {
        const { accountId, sendAt, ...requested } = parse(ScheduleSchema, await readJson(req));
        const outgoing = withTracking(req, accountId, requested);
        if (Date.parse(sendAt) <= Date.now()) throw new HttpError(400, "sendAt must be in the future");
        return scheduler.create(accountId, outgoing, new Date(sendAt));
      },
    ],
    ["GET", "/api/scheduled/:sid", (_req, params) => scheduler.get(params.sid!)],
    [
      "PATCH",
      "/api/scheduled/:sid",
      async (req, params) => {
        const { sendAt, ...update } = parse(ScheduleUpdateSchema, await readJson(req));
        if (sendAt && Date.parse(sendAt) <= Date.now()) throw new HttpError(400, "sendAt must be in the future");
        return scheduler.update(params.sid!, { ...update, sendAt: sendAt ? new Date(sendAt) : undefined });
      },
    ],
    ["POST", "/api/scheduled/:sid/send", (_req, params) => scheduler.sendNow(params.sid!)],
    [
      "DELETE",
      "/api/scheduled/:sid",
      (_req, params) => {
        scheduler.remove(params.sid!);
        return { ok: true };
      },
    ],
  ];

  const server = createServer(async (req, res) => {
    const started = Date.now();
    res.on("finish", () => {
      if (req.method !== "OPTIONS") console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
    });
    // The apps run on other origins (Expo web, Electron); the token is the real gate.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    if (req.method === "OPTIONS") return send(res, 204);

    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, { ok: true, version, time: new Date().toISOString() });
    }

    // The open-tracking pixel: public (recipients load it), always the same image.
    const pixel = req.method === "GET" && /^\/t\/([0-9a-f]{32})\.gif$/.exec(url.pathname);
    if (pixel) {
      // Loaded inside this app (you reading your own mail): served, never counted.
      if (!fromApp(req, appOrigins)) tracking.recordOpen(pixel[1]!, req.headers["user-agent"], clientIp(req));
      // Every way of saying "don't keep this": each open should reach the server again.
      res.writeHead(200, {
        "Content-Type": "image/gif",
        "Content-Length": TRACKING_GIF.length,
        "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0, s-maxage=0, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
        "Surrogate-Control": "no-store",
        "CDN-Cache-Control": "no-store",
      });
      return res.end(TRACKING_GIF);
    }

    const auth = Buffer.from(req.headers.authorization ?? "");
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      return send(res, 401, { error: "Unauthorized" });
    }

    if (req.method === "GET" && url.pathname === "/api/events") return streamEvents(req, res, watcher, reminders);

    try {
      let pathMatched = false;
      for (const [method, pattern, handler] of routes) {
        const params = matchPath(pattern, url.pathname);
        if (!params) continue;
        pathMatched = true;
        if (method !== req.method) continue;
        const result = await handler(req, params, url);
        if (result instanceof FileResponse) return sendFile(res, result);
        return send(res, 200, result);
      }
      send(res, pathMatched ? 405 : 404, { error: pathMatched ? "Method not allowed" : "Not found" });
    } catch (err) {
      if (err instanceof HttpError || err instanceof MailError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: describe(err) });
    }
  });

  server.listen(port, host, () => console.log(`Mail API listening on http://${host}:${port}`));
  return server;
}

/**
 * Server-sent events for the apps: `event: mail` with a NewMail as data each
 * time mail arrives. Comments every 25s keep proxies from closing it.
 */
function streamEvents(req: IncomingMessage, res: ServerResponse, watcher: NewMailWatcher, reminders: EventReminders): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // nginx: don't buffer the stream
  });
  res.write(": connected\n\n");
  const onMail = (mail: NewMail) => res.write(`event: mail\ndata: ${JSON.stringify(mail)}\n\n`);
  const onReminder = (reminder: EventReminder) => res.write(`event: reminder\ndata: ${JSON.stringify(reminder)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  watcher.on("mail", onMail);
  reminders.on("reminder", onReminder);
  req.on("close", () => {
    clearInterval(ping);
    watcher.off("mail", onMail);
    reminders.off("reminder", onReminder);
  });
}

function matchPath(pattern: string, path: string): Params | null {
  const want = pattern.split("/").filter(Boolean);
  const got = path.split("/").filter(Boolean);
  if (want.length !== got.length) return null;
  const params: Params = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i]!.startsWith(":")) params[want[i]!.slice(1)] = decodeURIComponent(got[i]!);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, z.prettifyError(result.error));
  return result.data;
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, body === undefined ? {} : { "Content-Type": "application/json" });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function sendFile(res: ServerResponse, file: FileResponse): void {
  res.writeHead(200, {
    "Content-Type": file.contentType || "application/octet-stream",
    "Content-Length": file.content.length,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
  });
  res.end(file.content);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 35_000_000) throw new HttpError(413, "Body too large");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

/**
 * The address a request came from. Behind the nginx proxy that's X-Real-IP, or
 * the last X-Forwarded-For entry (the one nginx itself saw); else the socket's.
 */
function clientIp(req: IncomingMessage): string | undefined {
  const header = (name: string) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value.join(",") : value;
  };
  const real = header("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = header("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  if (forwarded?.length) return forwarded.at(-1);
  return req.socket.remoteAddress?.replace(/^::ffff:/, "");
}

/**
 * The request came from a page of this app: its Referer (or Origin) is one of
 * `appOrigins`, or a copy running on this machine (localhost, a dev build).
 * Mail apps send neither header, and webmail sends its own site.
 */
function fromApp(req: IncomingMessage, appOrigins: string[]): boolean {
  const source = String(req.headers.referer ?? req.headers.origin ?? "");
  if (!source) return false;
  let host: string;
  try {
    host = new URL(source).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")) return true;
  return appOrigins.some((origin) => {
    try {
      return new URL(origin).hostname.toLowerCase() === host;
    } catch {
      return origin.toLowerCase() === host;
    }
  });
}
