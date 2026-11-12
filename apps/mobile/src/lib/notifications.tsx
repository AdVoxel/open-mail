import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import { displayName, type CalendarEvent, type EventReminder, type NewMail } from "@mail-app/api-client";
import { useNotify } from "@/src/components/kit";
import { dayStart, eventKey, formatEventTime, openedEvents } from "./calendarDates";
import { useApi } from "./connection";
import { useLock } from "./lock";
import { useMail } from "./mail";
import { loadJson, saveJson } from "./storage";

const STORAGE_KEY = "mail.notifications";
const ALERTS_KEY = "mail.eventAlerts";

/** "In 15 min", "In 2 h", "Now"… until the event starts. */
function untilStart(event: CalendarEvent): string {
  const start = event.allDay ? dayStart(event.start).getTime() : Date.parse(event.start);
  const minutes = Math.round((start - Date.now()) / 60_000);
  if (minutes <= 0) return "Now";
  if (minutes < 60) return `In ${minutes} min`;
  if (minutes < 24 * 60) return `In ${Math.round(minutes / 60)} h`;
  const days = Math.round(minutes / (24 * 60));
  return days === 1 ? "Tomorrow" : `In ${days} days`;
}

function openEvent(event: CalendarEvent) {
  const key = eventKey(event);
  openedEvents.set(key, event);
  router.push({ pathname: "/event", params: { key } });
}

/** Browser and desktop app (Electron) for now; phones come later. */
export const notificationsSupported = Platform.OS === "web" && typeof window !== "undefined" && "Notification" in window;

export type NotificationPermissionState = NotificationPermission | "unsupported";

interface NotificationsState {
  supported: boolean;
  /** The user turned them on on this device (and the system allows them). */
  enabled: boolean;
  permission: NotificationPermissionState;
  /** Turning on asks the system for permission the first time. Resolves the resulting permission. */
  setEnabled: (on: boolean) => Promise<NotificationPermissionState>;
  /** Shows a sample notification. */
  test: () => void;
  /** Calendar alerts: an in-app notice, plus a system notification when those are on. */
  eventAlerts: boolean;
  setEventAlerts: (on: boolean) => void;
}

const Context = createContext<NotificationsState | null>(null);

function show(title: string, body: string, tag: string, onClick?: () => void) {
  const notification = new Notification(title, { body, tag });
  notification.onclick = () => {
    window.focus();
    notification.close();
    onClick?.();
  };
}

/**
 * Listens to the server for new mail: refreshes the list when it concerns the
 * mailbox on screen, and shows a system notification when they're on.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const { refresh, mailbox } = useMail();
  const { locked } = useLock();
  const notify = useNotify();
  const [eventAlerts, setEventAlertsState] = useState(true);
  const [enabled, setEnabledState] = useState(false);
  const [permission, setPermission] = useState<NotificationPermissionState>(
    notificationsSupported ? Notification.permission : "unsupported",
  );

  useEffect(() => {
    void loadJson<boolean>(STORAGE_KEY).then((saved) => saved !== null && setEnabledState(saved));
    void loadJson<boolean>(ALERTS_KEY).then((saved) => saved !== null && setEventAlertsState(saved));
  }, []);

  // The stream outlives renders; it reads the latest values from here.
  const latest = useRef({ enabled, refresh, mailbox, locked, eventAlerts, notify });
  latest.current = { enabled, refresh, mailbox, locked, eventAlerts, notify };

  useEffect(() => {
    if (!notificationsSupported) return; // needs a streaming fetch, which phones' fetch lacks
    const controller = new AbortController();
    const onMail = ({ message, preview }: NewMail) => {
      const { enabled, refresh, mailbox, locked } = latest.current;
      const inboxShown = mailbox.folder.toUpperCase() === "INBOX" && (mailbox.accountId === null || mailbox.accountId === message.accountId);
      if (inboxShown) {
        void refresh();
      }
      if (!enabled || Notification.permission !== "granted") return;
      // While locked, nothing about the message shows outside the app.
      if (locked) return show("New mail", "Unlock Mail to read it.", "mail-locked");
      const from = displayName(message.from);
      show(message.subject, preview ? `${from}: ${preview}` : from, `${message.accountId}:${message.uid}`, () =>
        router.push({ pathname: "/message", params: { accountId: message.accountId, folder: message.folder, uid: String(message.uid) } }),
      );
    };
    const onReminder = ({ event }: EventReminder) => {
      const { enabled, locked, eventAlerts, notify } = latest.current;
      if (!eventAlerts) return;
      const details = [untilStart(event), formatEventTime(event), event.location].filter(Boolean).join(" · ");
      if (!locked) notify(event.title, details, "info", { duration: 15_000, action: { label: "Open", onPress: () => openEvent(event) } });
      if (!enabled || Notification.permission !== "granted") return;
      if (locked) return show("Calendar alert", "Unlock Mail to see it.", "event-locked");
      show(event.title, details, `event:${eventKey(event)}`, () => openEvent(event));
    };
    void (async () => {
      for (let attempt = 0; !controller.signal.aborted; attempt++) {
        try {
          await api.watchNewMail(onMail, controller.signal, onReminder);
          attempt = 0; // it was connected: reconnect quickly
        } catch {
          // Server down, offline or too old for /api/events: try again later.
        }
        if (controller.signal.aborted) return;
        await new Promise((r) => setTimeout(r, Math.min(60_000, 2_000 * 2 ** attempt)));
      }
    })();
    return () => controller.abort();
  }, [api]);

  const setEnabled = useCallback(async (on: boolean): Promise<NotificationPermissionState> => {
    if (!notificationsSupported) return "unsupported";
    let current = Notification.permission;
    if (on && current === "default") current = await Notification.requestPermission();
    setPermission(current);
    const next = on && current === "granted";
    setEnabledState(next);
    void saveJson(STORAGE_KEY, next);
    return current;
  }, []);

  const test = useCallback(() => {
    if (notificationsSupported && Notification.permission === "granted") {
      show("Notifications are on", "New mail will show up like this.", "mail-test");
    }
  }, []);

  const setEventAlerts = useCallback((on: boolean) => {
    setEventAlertsState(on);
    void saveJson(ALERTS_KEY, on);
  }, []);

  const value = useMemo(
    () => ({ supported: notificationsSupported, enabled: enabled && permission === "granted", permission, setEnabled, test, eventAlerts, setEventAlerts }),
    [enabled, permission, setEnabled, test, eventAlerts, setEventAlerts],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNotifications(): NotificationsState {
  const value = useContext(Context);
  if (!value) throw new Error("useNotifications must be used inside NotificationsProvider");
  return value;
}
