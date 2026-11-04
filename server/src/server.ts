import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  ConfigStore,
  DEFAULT_DRAFT_ROUTE,
  DEFAULT_TRIAGE_ROUTE,
  draftReply,
  MailService,
  RefusalError,
  triageEmail,
  type AiJob,
  type AiSettings,
  type MailMessage,
  type Triage,
} from "@mail-app/core";

export interface ServerOptions {
  port: number;
  host: string;
  token: string;
  mail?: MailService;
  /** Present in the desktop app: enables AI settings stored with encrypted keys. */
  store?: ConfigStore;
  /** Opens a URL in the user's browser; enables "Sign in with Google". */
  openUrl?: (url: string) => Promise<void> | void;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const HostSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
});

const AccountInputSchema = z.object({
  label: z.string().optional(),
  address: z.string().trim().min(3),
  user: z.string().optional(),
  password: z.string().min(1),
  imap: HostSchema,
  smtp: HostSchema,
});

const AiUpdateSchema = z.object({
  route: z.object({
    provider: z.enum(["anthropic", "openai-compatible"]),
    model: z.string().trim().min(1),
    baseUrl: z.url().optional(),
  }),
  apiKey: z.string().nullable().optional(), // undefined keeps, null/"" clears
});

const SendSchema = z.object({
  to: z.string().min(1),
  subject: z.string(),
  body: z.string().min(1),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
});

type Params = Record<string, string>;
type Handler = (req: IncomingMessage, params: Params, url: URL) => Promise<unknown> | unknown;

/**
 * Local API used by both the desktop and mobile apps. Every request needs
 * `Authorization: Bearer <token>`; the AI keys and mail passwords never leave
 * this process.
 */
export function startServer({ port, host, token, store, openUrl, mail = new MailService({ store }) }: ServerOptions): Server {
  if (!token) throw new Error("MAIL_APP_TOKEN is required");
  const expected = Buffer.from(`Bearer ${token}`);

  // Each email is fetched and triaged at most once per run (until settings change).
  const triageCache = new Map<string, Triage>();
  const messageCache = new Map<string, MailMessage>();

  function forgetAccount(accountId: string) {
    for (const cache of [triageCache, messageCache]) {
      for (const key of cache.keys()) if (key.startsWith(`${accountId}:`)) cache.delete(key);
    }
  }

  function aiSettings(job: AiJob): AiSettings {
    if (store) return store.aiRoute(job);
    return { route: job === "triage" ? DEFAULT_TRIAGE_ROUTE : DEFAULT_DRAFT_ROUTE };
  }

  function requireAccount(params: Params): string {
    if (!mail.hasAccount(params.id!)) throw new HttpError(404, `Account "${params.id}" is not configured`);
    return params.id!;
  }

  function parseUid(params: Params): number {
    const uid = Number(params.uid);
    if (!Number.isInteger(uid)) throw new HttpError(400, "Invalid message uid");
    return uid;
  }

  async function loadMessage(accountId: string, uid: number): Promise<MailMessage> {
    const key = `${accountId}:${uid}`;
    let message = messageCache.get(key);
    if (!message) {
      message = await mail.getMessage(accountId, uid);
      messageCache.set(key, message);
    }
    return message;
  }

  const routes: [method: string, pattern: string, handler: Handler][] = [
    [
      "GET",
      "/api/capabilities",
      () => ({
        manageAccounts: mail.canManageAccounts,
        googleSignIn: mail.canSignInWithGoogle && openUrl !== undefined,
        editAiSettings: store !== undefined,
      }),
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
    ["POST", "/api/accounts", async (req) => mail.addAccount(parse(AccountInputSchema, await readJson(req)))],
    [
      "POST",
      "/api/accounts/google",
      () => {
        if (!openUrl) throw new HttpError(501, "Google sign-in is only available in the desktop app");
        return mail.addGoogleAccount(openUrl);
      },
    ],
    [
      "DELETE",
      "/api/accounts/:id",
      (_req, params) => {
        mail.removeAccount(requireAccount(params));
        forgetAccount(params.id!);
        return { ok: true };
      },
    ],

    // AI settings (API keys are write-only: reads only say whether one is saved)
    [
      "GET",
      "/api/settings/ai",
      () =>
        Object.fromEntries(
          (["triage", "draft"] as const).map((job) => {
            const { route, apiKey } = aiSettings(job);
            return [job, { route, hasApiKey: Boolean(apiKey) }];
          }),
        ),
    ],
    [
      "PUT",
      "/api/settings/ai/:job",
      async (req, params) => {
        if (!store) throw new HttpError(501, "AI settings can only be changed in the desktop app");
        const job = params.job;
        if (job !== "triage" && job !== "draft") throw new HttpError(404, "Unknown AI job");
        const { route, apiKey } = parse(AiUpdateSchema, await readJson(req));
        if (route.provider === "openai-compatible" && !route.baseUrl) {
          throw new HttpError(400, "A base URL is required for OpenAI-compatible providers");
        }
        store.setAiRoute(job, route, apiKey === "" ? null : apiKey);
        if (job === "triage") triageCache.clear();
        return { ok: true };
      },
    ],

    // Mail
    [
      "GET",
      "/api/accounts/:id/messages",
      (_req, params, url) => {
        const limit = Math.min(Number(url.searchParams.get("limit")) || 30, 100);
        return mail.listInbox(requireAccount(params), limit);
      },
    ],
    ["GET", "/api/accounts/:id/messages/:uid", (_req, params) => loadMessage(requireAccount(params), parseUid(params))],
    [
      "GET",
      "/api/accounts/:id/messages/:uid/triage",
      async (_req, params) => {
        const accountId = requireAccount(params);
        const uid = parseUid(params);
        const key = `${accountId}:${uid}`;
        let triage = triageCache.get(key);
        if (!triage) {
          triage = await triageEmail(await loadMessage(accountId, uid), aiSettings("triage"));
          triageCache.set(key, triage);
        }
        return triage;
      },
    ],
    [
      "POST",
      "/api/accounts/:id/messages/:uid/draft",
      async (req, params) => {
        const message = await loadMessage(requireAccount(params), parseUid(params));
        const { instructions } = parse(z.object({ instructions: z.string().optional() }), await readJson(req));
        return { draft: await draftReply(message, instructions, aiSettings("draft")) };
      },
    ],
    [
      "POST",
      "/api/accounts/:id/send",
      async (req, params) => {
        await mail.send({ accountId: requireAccount(params), ...parse(SendSchema, await readJson(req)) });
        return { ok: true };
      },
    ],
  ];

  const server = createServer(async (req, res) => {
    // The Electron renderer is served from another origin in dev; the token is the real gate.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return send(res, 204);

    const auth = Buffer.from(req.headers.authorization ?? "");
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      return send(res, 401, { error: "Unauthorized" });
    }

    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      for (const [method, pattern, handler] of routes) {
        const params = method === req.method ? matchPath(pattern, url.pathname) : null;
        if (params) return send(res, 200, await handler(req, params, url));
      }
      send(res, 404, { error: "Not found" });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      if (err instanceof RefusalError) return send(res, 422, { error: err.message });
      console.error(err);
      send(res, 500, { error: err instanceof Error ? err.message : "Internal error" });
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

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new HttpError(413, "Body too large");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}
