// The mail server: holds the accounts, talks IMAP/SMTP to Gmail, iCloud and
// Zoho, sends scheduled mail, and serves the API the apps use. Meant to run
// on an always-on machine (e.g. a Raspberry Pi); for now, on this computer.
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aesCipher,
  CalendarService,
  checkGoogleClient,
  EventReminders,
  ConfigStore,
  LabelStore,
  LockService,
  MailError,
  MailService,
  NewMailWatcher,
  Scheduler,
  TrackingStore,
} from "@mail-app/core";
import { startServer } from "./server.js";

// Every key comes from the process environment (see ENVIRONMENT.md); nothing is read from or written to key files.
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set. Export it before starting the server (see ENVIRONMENT.md).`);
    process.exit(1);
  }
  return value;
}

const token = required("MAIL_APP_TOKEN");
const key = Buffer.from(required("MAIL_APP_SECRET_KEY"), "base64");
if (key.length !== 32) {
  console.error("MAIL_APP_SECRET_KEY must be 32 bytes, base64-encoded (see ENVIRONMENT.md).");
  process.exit(1);
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const dataDir = resolve(process.env.MAIL_APP_DATA_DIR || join(repoRoot, "server/data"));

const store = new ConfigStore(join(dataDir, "accounts.json"), aesCipher(key));
const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
// The Google OAuth client: from the environment if set, else the one saved from the apps' Settings.
const envGoogle = clientId && clientSecret ? { clientId, clientSecret } : undefined;
const google = () => envGoogle ?? store.googleClient();
const mail = new MailService({ store, google });
const calendars = new CalendarService(mail, store, google);
const reminders = new EventReminders(calendars);
const scheduler = new Scheduler(join(dataDir, "scheduled.json"), mail);
const watcher = new NewMailWatcher(mail);

const server = startServer({
  port: Number(process.env.MAIL_APP_PORT) || 8787,
  host: process.env.MAIL_APP_HOST || "0.0.0.0",
  token,
  mail,
  scheduler,
  labels: new LabelStore(join(dataDir, "labels.json")),
  watcher,
  reminders,
  calendars,
  tracking: new TrackingStore(join(dataDir, "tracking.json")),
  publicUrl: process.env.MAIL_APP_PUBLIC_URL || undefined,
  googleClient: {
    status: () => ({
      configured: Boolean(google()),
      source: envGoogle ? "environment" : store.googleClient() ? "app" : null,
      clientId: google()?.clientId ?? null,
    }),
    save: async (client) => {
      if (envGoogle) throw new MailError(409, "The OAuth client is set in the server's environment; change it there");
      try {
        await checkGoogleClient(client);
      } catch (err) {
        throw new MailError(400, (err as Error).message);
      }
      store.setGoogleClient(client);
    },
    remove: () => {
      if (envGoogle) throw new MailError(409, "The OAuth client is set in the server's environment; remove it there");
      store.setGoogleClient(null);
    },
  },
  lock: new LockService(join(dataDir, "lock.json"), mail),
  version: process.env.npm_package_version,
});
scheduler.start();
watcher.start();
reminders.start();
console.log(`Data: ${dataDir}`);

async function shutdown() {
  scheduler.stop();
  watcher.stop();
  reminders.stop();
  server.close();
  await mail.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
