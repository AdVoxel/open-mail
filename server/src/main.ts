// The mail server: holds the accounts, talks IMAP/SMTP to Gmail, iCloud and
// Zoho, sends scheduled mail, and serves the API the apps use. Meant to run
// on an always-on machine (e.g. a Raspberry Pi); for now, on this computer.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aesCipher, ConfigStore, loadOrCreateKey, MailService, Scheduler } from "@mail-app/core";
import { startServer } from "./server.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const token = process.env.MAIL_APP_TOKEN ?? "";
if (!token) {
  console.error(`MAIL_APP_TOKEN is not set. Add it to ${envFile} (see .env.example).`);
  process.exit(1);
}

const dataDir = resolve(process.env.MAIL_APP_DATA_DIR || join(repoRoot, "server/data"));
const key = process.env.MAIL_APP_SECRET_KEY
  ? Buffer.from(process.env.MAIL_APP_SECRET_KEY, "base64")
  : loadOrCreateKey(join(dataDir, "secret.key"));

const store = new ConfigStore(join(dataDir, "accounts.json"), aesCipher(key));
const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
const mail = new MailService({ store, google: clientId && clientSecret ? { clientId, clientSecret } : undefined });
const scheduler = new Scheduler(join(dataDir, "scheduled.json"), mail);

const server = startServer({
  port: Number(process.env.MAIL_APP_PORT) || 8787,
  host: process.env.MAIL_APP_HOST || "0.0.0.0",
  token,
  mail,
  scheduler,
  version: process.env.npm_package_version,
});
scheduler.start();
console.log(`Data: ${dataDir}`);

async function shutdown() {
  scheduler.stop();
  server.close();
  await mail.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
