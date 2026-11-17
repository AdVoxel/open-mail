// Mail's service worker: counts unread mail in every account's inbox.
//
// The open app asks for a check at the interval set in Settings ("check" message,
// with the server address and token, which a worker can't read from the page's
// storage). The worker fetches the counts once for every open tab, then sends the
// total to all of them. Where the browser offers periodic background sync (Chrome,
// installed app), it also checks while no tab is open, at the browser's own pace.
//
// No fetch handler and no caching: the app's files always come from the network.

const CONFIG_CACHE = "mail-sw-config";
const CONFIG_URL = "/__mail-sw/config";
/** Several tabs ask at about the same time: answer them from one check. */
const REUSE_MS = 5_000;

let inFlight = null;
let last = null; // { count, at }
/** A forced check asked for while another was running: run it right after (a Refresh must not get an older answer). */
let queued = null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function saveConfig(server) {
  if (!server) return;
  const cache = await caches.open(CONFIG_CACHE);
  await cache.put(CONFIG_URL, new Response(JSON.stringify(server)));
}

async function loadConfig() {
  const cache = await caches.open(CONFIG_CACHE);
  const res = await cache.match(CONFIG_URL);
  return res ? res.json() : null;
}

async function getJson(server, path) {
  const res = await fetch(`${server.url}/api${path}`, { headers: { Authorization: `Bearer ${server.token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Unread messages in every account's inbox, or null when no account answered. */
async function countUnread(server, fresh) {
  const accounts = await getJson(server, "/accounts");
  const counts = await Promise.all(
    accounts.map(async (account) => {
      try {
        const folders = await getJson(server, `/accounts/${encodeURIComponent(account.id)}/folders${fresh ? "?fresh" : ""}`);
        const inbox = folders.find((f) => f.role === "inbox" || f.path.toUpperCase() === "INBOX");
        return inbox?.unread ?? 0;
      } catch {
        return null; // this account is unreachable: count the others
      }
    }),
  );
  const answered = counts.filter((c) => c !== null);
  if (accounts.length && !answered.length) return null;
  return answered.reduce((sum, c) => sum + c, 0);
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

async function setAppBadge(count) {
  try {
    if (count > 0) await self.navigator.setAppBadge?.(count);
    else await self.navigator.clearAppBadge?.();
  } catch {
    // Not an installed app, or no badge support.
  }
}

async function check(server, fresh, force) {
  if (!server) return;
  if (!force && last && Date.now() - last.at < REUSE_MS) return broadcast({ type: "unread", count: last.count });
  if (inFlight) {
    if (force) queued = { server, fresh: fresh || Boolean(queued?.fresh) };
    return inFlight;
  }
  inFlight = (async () => {
    try {
      const count = await countUnread(server, fresh);
      if (count === null) return;
      last = { count, at: Date.now() };
      await setAppBadge(count);
      await broadcast({ type: "unread", count });
    } catch {
      // Server unreachable: keep the last count until the next check.
    } finally {
      inFlight = null;
      if (queued) {
        const next = queued;
        queued = null;
        void check(next.server, next.fresh, true);
      }
    }
  })();
  return inFlight;
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "check") {
    event.waitUntil(saveConfig(data.server).then(() => check(data.server, Boolean(data.fresh), Boolean(data.force))));
  }
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "check-mail") event.waitUntil(loadConfig().then((server) => check(server, true, true)));
});
