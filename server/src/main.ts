// Standalone entry: runs the API without the desktop app (e.g. on an always-on Mac).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.js";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

startServer({
  port: Number(process.env.MAIL_APP_PORT) || 8787,
  host: process.env.MAIL_APP_HOST || "0.0.0.0",
  token: process.env.MAIL_APP_TOKEN ?? "",
});
