// Desktop shell: a native window around the shared Expo/gluestack UI.
// The UI talks to the mail server over HTTP; no mail code runs here.
import { app, BrowserWindow, ipcMain, net, Notification, protocol, shell } from "electron";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

// Dev: the Expo web dev server (npm run web). Packaged: the exported build in out/web.
const devUrl = process.env.MAIL_UI_URL ?? (app.isPackaged ? undefined : "http://localhost:8081");
const webRoot = join(import.meta.dirname, "../web");
const activeNotifications = new Map<string, Notification>();

// A standard scheme gives the UI a stable origin, so its saved settings persist.
// Not "secure": the UI must be able to call an http:// server on your network.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, supportFetchAPI: true, corsEnabled: true } },
]);

function serveExportedUi(): void {
  protocol.handle("app", (request) => {
    const path = normalize(decodeURIComponent(new URL(request.url).pathname)).replace(/^([/\\])+/, "");
    const file = join(webRoot, path);
    // Unknown paths are app routes (single-page app): serve index.html.
    const target = file.startsWith(webRoot) && extname(file) && existsSync(file) ? file : join(webRoot, "index.html");
    return net.fetch(pathToFileURL(target).toString());
  });
}

function registerNotificationIpc(): void {
  ipcMain.handle("mail:notifications-supported", () => Notification.isSupported());
  ipcMain.on("mail:show-notification", (event, request: { title: string; body: string; tag: string }) => {
    if (!BrowserWindow.fromWebContents(event.sender) || !Notification.isSupported()) return;
    activeNotifications.get(request.tag)?.close();
    const notification = new Notification({ title: request.title, body: request.body, id: request.tag });
    activeNotifications.set(request.tag, notification);
    notification.on("click", () => {
      if (!event.sender.isDestroyed()) event.sender.send("mail:notification-click", request.tag);
    });
    notification.on("close", () => {
      if (activeNotifications.get(request.tag) === notification) activeNotifications.delete(request.tag);
    });
    notification.show();
  });
}

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 760,
    minHeight: 520,
    title: "Mail",
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(import.meta.dirname, "../preload/index.mjs"),
    },
  });

  win.webContents.on("destroyed", () => activeNotifications.clear());

  // Links in emails open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://") && !(devUrl && url.startsWith(devUrl))) {
      event.preventDefault();
      if (/^https?:|^mailto:/.test(url)) void shell.openExternal(url);
    }
  });

  if (devUrl) {
    await waitFor(devUrl);
    await win.loadURL(devUrl);
  } else {
    await win.loadURL("app://mail/");
  }

}

// Windows shows notifications only for an app with an id (the same as the installer's appId).
app.setAppUserModelId("com.openmail.desktop");

app.whenReady().then(() => {
  registerNotificationIpc();
  if (!devUrl) serveExportedUi();
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
