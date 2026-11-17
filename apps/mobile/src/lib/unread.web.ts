import { useCallback, useEffect, useState } from "react";
import type { MailApi } from "@mail-app/api-client";
import { useApi, useConnection } from "./connection";
import { useMail } from "./mail";
import { useThemeMode } from "./theme";

type ServiceWorkerRegistrationWithSync = ServiceWorkerRegistration & {
  periodicSync?: { register: (tag: string, options: { minInterval: number }) => Promise<void> };
};

let registration: Promise<ServiceWorkerRegistrationWithSync | null> | null = null;

/**
 * Registers public/sw.js once. Null where there's no service worker: the desktop
 * app (its app:// pages aren't a secure context), plain-http sites, old browsers,
 * or a server that answers /sw.js with the page.
 */
function serviceWorker(): Promise<ServiceWorkerRegistrationWithSync | null> {
  registration ??= (async () => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
    try {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      return await navigator.serviceWorker.ready;
    } catch {
      return null;
    }
  })();
  return registration;
}

/** Without a service worker: the same count, from the page. */
async function countHere(api: MailApi, accountIds: string[], fresh: boolean): Promise<number | null> {
  const results = await Promise.allSettled(accountIds.map((id) => api.folders(id, fresh)));
  const counts = results.flatMap((r) => {
    if (r.status !== "fulfilled") return [];
    const inbox = r.value.find((f) => f.role === "inbox" || f.path.toUpperCase() === "INBOX");
    return [inbox?.unread ?? 0];
  });
  if (accountIds.length && !counts.length) return null;
  return counts.reduce((sum, c) => sum + c, 0);
}

/** "99+" past two digits. */
function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** The tab icon: the app's chevron in the accent color, with the unread count. */
function drawIcon(count: number, color: string): string {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(2, 2, size - 4, size - 4, 14);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(12, 48);
  ctx.lineTo(26, 31);
  ctx.lineTo(40, 48);
  ctx.stroke();

  const text = badgeText(count);
  const height = 34;
  ctx.font = `bold ${text.length > 2 ? 22 : 26}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const width = Math.max(height, ctx.measureText(text).width + 12);
  const x = size - width;
  ctx.fillStyle = "#e7000b";
  ctx.beginPath();
  ctx.roundRect(x, 0, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + width / 2, height / 2 + 1);
  return canvas.toDataURL("image/png");
}

let original: { href: string | null; type: string | null } | null = null;

/** Shows the count on the tab icon (and the dock or taskbar icon of an installed app); 0 restores the plain icon. */
function showBadge(count: number, color: string) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  (count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.())?.catch(() => undefined);

  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  original ??= { href: link.getAttribute("href"), type: link.getAttribute("type") };
  const icon = count > 0 ? drawIcon(count, color) : "";
  if (icon) {
    link.type = "image/png";
    link.href = icon;
  } else {
    if (original.href) link.setAttribute("href", original.href);
    else link.removeAttribute("href");
    if (original.type) link.setAttribute("type", original.type);
    else link.removeAttribute("type");
  }
}

/**
 * Keeps the unread count of every account's inbox on the browser's tab icon.
 * The service worker checks at the interval set in Settings (once for every
 * open tab); after you read or delete mail the count updates right away.
 */
export function useUnreadBadge(): void {
  const api = useApi();
  const { connection } = useConnection();
  const { accounts, checkInterval, list, refreshTick } = useMail();
  const { accent } = useThemeMode();
  const [count, setCount] = useState(0);
  const accountIds = accounts.map((a) => a.id).join("\n");

  const check = useCallback(
    async ({ fresh, force }: { fresh: boolean; force: boolean }) => {
      const worker = (await serviceWorker())?.active;
      if (worker && connection) {
        worker.postMessage({ type: "check", server: { url: connection.url, token: connection.token }, fresh, force });
        return;
      }
      const total = await countHere(api, accountIds ? accountIds.split("\n") : [], fresh).catch(() => null);
      if (total !== null) setCount(total);
    },
    [api, connection, accountIds],
  );

  // Counts the worker sends to every open tab.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; count?: unknown } | null;
      if (data?.type === "unread" && typeof data.count === "number") setCount(data.count);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.startMessages();
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // At the chosen interval, in the background too (the server is asked to look again).
  useEffect(() => {
    void check({ fresh: true, force: true });
    const timer = setInterval(() => void check({ fresh: true, force: false }), checkInterval * 1000);
    return () => clearInterval(timer);
  }, [check, checkInterval]);

  // Read, unread, deleted or new mail in the list: count again soon.
  const loadedUnread = list.messages.reduce((n, m) => n + (m.seen ? 0 : 1), 0);
  useEffect(() => {
    const timer = setTimeout(() => void check({ fresh: false, force: true }), 1_500);
    return () => clearTimeout(timer);
  }, [check, loadedUnread, list.total]);

  // The Refresh button: count again now, asking the server for fresh numbers.
  useEffect(() => {
    if (refreshTick) void check({ fresh: true, force: true });
  }, [check, refreshTick]);

  // Installed app on Chrome: also check while no tab is open, as often as the browser allows.
  useEffect(() => {
    void serviceWorker().then(async (reg) => {
      if (!reg?.periodicSync) return;
      const status = await navigator.permissions.query({ name: "periodic-background-sync" as PermissionName }).catch(() => null);
      if (status?.state === "granted") await reg.periodicSync.register("check-mail", { minInterval: checkInterval * 1000 }).catch(() => undefined);
    });
  }, [checkInterval]);

  useEffect(() => showBadge(count, accent.light), [count, accent.light]);
  useEffect(() => () => showBadge(0, ""), []);
}
