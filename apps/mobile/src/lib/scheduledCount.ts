// How many messages are waiting to be sent (scheduled, or in the send delay),
// for the number on "Scheduled" in the sidebar. One shared count for the app:
// screens that change the queue call refreshScheduled() so it updates at once.
import { useEffect, useSyncExternalStore } from "react";
import type { ScheduledMail } from "@mail-app/api-client";
import { useApi } from "./connection";

/** Without anything due, look again this often (a message scheduled elsewhere). */
const IDLE_REFRESH_MS = 60_000;
/** After a message is due, give the server this long to send it before looking. */
const AFTER_DUE_MS = 2_500;

let count = 0;
let load: (() => Promise<ScheduledMail[]>) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

/** Waiting to go: not sent yet, and not given up on. */
const waiting = (m: ScheduledMail) => m.status === "pending" || m.status === "sending";

/** Reloads the count now, then again just after the next message is due. */
export async function refreshScheduled(): Promise<void> {
  if (!load) return;
  clearTimeout(timer);
  let next = IDLE_REFRESH_MS;
  try {
    const queue = (await load()).filter(waiting);
    if (queue.length !== count) {
      count = queue.length;
      listeners.forEach((l) => l());
    }
    const due = Math.min(...queue.map((m) => Date.parse(m.sendAt)).filter(Number.isFinite));
    if (Number.isFinite(due)) next = Math.min(IDLE_REFRESH_MS, Math.max(1_000, due - Date.now() + AFTER_DUE_MS));
  } catch {
    // Offline or an older server: keep the last count and try again later.
  }
  timer = setTimeout(() => void refreshScheduled(), next);
}

/** The number of messages waiting to be sent; keeps itself up to date while shown. */
export function useScheduledCount(): number {
  const api = useApi();
  useEffect(() => {
    load = () => api.scheduled();
    void refreshScheduled();
    return () => {
      clearTimeout(timer);
      load = null;
    };
  }, [api]);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => count,
  );
}
