import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { describe, MailError, type AccountInfo, type MailService, type Scheduler } from "@mail-app/core";

export interface ServerOptions {
  port: number;
  host: string;
  token: string;
  mail: MailService;
  scheduler: Scheduler;
  version?: string;
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

const AccountInputSchema = z.object({
  label: z.string().optional(),
  name: z.string().optional(),
  address: z.string().trim().min(3),
  user: z.string().optional(),
  password: z.string().min(1),
  imap: HostSchema,
  smtp: HostSchema,
  saveSentCopy: z.boolean().optional(),
});

const AccountUpdateSchema = z.object({
  label: z.string().trim().min(1).optional(),
  name: z.string().trim().optional(),
  saveSentCopy: z.boolean().optional(),
});

const MailSchema = z.object({
  to: z.string().trim().min(1, "Add at least one recipient"),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string(),
  text: z.string(),
  html: z.string().optional(),
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

const ScheduleSchema = MailSchema.extend({
  accountId: z.string().min(1),
  sendAt: z.iso.datetime({ offset: true }),
});

const ScheduleUpdateSchema = MailSchema.partial().extend({
  accountId: z.string().min(1).optional(),
  sendAt: z.iso.datetime({ offset: true }).optional(),
});

const FlagsSchema = z.object({
  seen: z.boolean().optional(),
  flagged: z.boolean().optional(),
  answered: z.boolean().optional(),
});

const MoveSchema = z.object({
  /** A folder path, or "inbox" | "archive" | "trash" | "junk". */
  to: z.string().min(1),
});

type Params = Record<string, string>;
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
export function startServer({ port, host, token, mail, scheduler, version = "dev" }: ServerOptions): Server {
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
    ["GET", "/api/capabilities", () => ({ version, manageAccounts: mail.canManageAccounts, googleSignIn: mail.canSignInWithGoogle })],

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
    ["POST", "/api/accounts", async (req) => mail.addAccount(parse(AccountInputSchema, await readJson(req)))],
    [
      "PATCH",
      "/api/accounts/:id",
      async (req, params) => mail.updateAccount(requireAccount(params), parse(AccountUpdateSchema, await readJson(req))),
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
      (_req, _params, url) => mail.listAllInboxes(intParam(url, "limit", 50, 200)),
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
        }),
    ],
    [
      "GET",
      "/api/accounts/:id/messages/:uid",
      (_req, params, url) => mail.getMessage(requireAccount(params), folderParam(url), uidParam(params)),
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
        const { sendAt, ...outgoing } = parse(SendSchema, await readJson(req));
        if (sendAt && Date.parse(sendAt) > Date.now() + 5_000) {
          return { scheduled: scheduler.create(accountId, outgoing, new Date(sendAt)) };
        }
        return { sent: await mail.send(accountId, outgoing) };
      },
    ],

    // Scheduled mail
    ["GET", "/api/scheduled", () => scheduler.list()],
    [
      "POST",
      "/api/scheduled",
      async (req) => {
        const { accountId, sendAt, ...outgoing } = parse(ScheduleSchema, await readJson(req));
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

    const auth = Buffer.from(req.headers.authorization ?? "");
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      return send(res, 401, { error: "Unauthorized" });
    }

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
