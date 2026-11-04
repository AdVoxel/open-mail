import { app, BrowserWindow, dialog, safeStorage, shell } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ConfigStore, MailService, type SecretCipher } from "@mail-app/core";
import { startServer } from "@mail-app/server";

// In dev the app path is apps/desktop; the shared .env lives at the repo root.
const envFile = join(app.getAppPath(), "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.MAIL_APP_PORT) || 8787;
const token = process.env.MAIL_APP_TOKEN ?? "";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "Mail",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Links in emails open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // The renderer only gets the local API address and token, never the real secrets.
  const query = { api: `http://127.0.0.1:${port}`, token };
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"), { query });
  }
}

app.whenReady().then(() => {
  if (!token) {
    dialog.showErrorBox("Missing configuration", `Set MAIL_APP_TOKEN in ${envFile} (see .env.example).`);
    app.quit();
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    dialog.showErrorBox("Keychain unavailable", "Mail needs the system keychain to store passwords safely.");
    app.quit();
    return;
  }

  // Passwords, Google tokens and AI keys are encrypted with the macOS Keychain.
  const cipher: SecretCipher = {
    encrypt: (plain) => safeStorage.encryptString(plain).toString("base64"),
    decrypt: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, "base64")),
  };
  const store = new ConfigStore(join(app.getPath("userData"), "config.json"), cipher);
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
  const mail = new MailService({ store, google: clientId && clientSecret ? { clientId, clientSecret } : undefined });

  // Listen on all interfaces so the phone app can reach it over Wi-Fi.
  startServer({
    port,
    host: process.env.MAIL_APP_HOST || "0.0.0.0",
    token,
    mail,
    store,
    openUrl: (url) => shell.openExternal(url),
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
