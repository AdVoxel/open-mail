import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { useApi } from "./connection";
import { loadJson, saveJson } from "./storage";

const AUTO_LOCK_KEY = "mail.autoLock";
/** Minutes without use before the app locks itself (0 = never). */
export const AUTO_LOCK_OPTIONS = [0, 1, 5, 15, 30] as const;
export type AutoLock = (typeof AUTO_LOCK_OPTIONS)[number];

interface LockState {
  /** The status is known (until then nothing is shown, so mail doesn't flash before the lock). */
  ready: boolean;
  /** A password is set (on the server, for every device). */
  enabled: boolean;
  locked: boolean;
  lock: () => void;
  /** Checks the password on the server; throws when it's wrong. */
  unlock: (password: string) => Promise<void>;
  /** After the password was set, changed or reset elsewhere in the app. */
  setEnabled: (enabled: boolean) => void;
  /** Ends the lock after a reset with a mailed code. */
  unlockAfterReset: () => void;
  autoLock: AutoLock;
  setAutoLock: (minutes: AutoLock) => void;
}

const Context = createContext<LockState | null>(null);

export function LockProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [ready, setReady] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [autoLock, setAutoLockState] = useState<AutoLock>(5);
  const lastActive = useRef(Date.now());

  // Locked from the start when a password is set. Older servers have no lock: unlocked.
  useEffect(() => {
    let cancelled = false;
    api.lockStatus().then(
      ({ enabled }) => {
        if (cancelled) return;
        setEnabledState(enabled);
        setLocked(enabled);
        setReady(true);
      },
      () => !cancelled && setReady(true),
    );
    void loadJson<number>(AUTO_LOCK_KEY).then((saved) => {
      if (!cancelled && AUTO_LOCK_OPTIONS.includes(saved as AutoLock)) setAutoLockState(saved as AutoLock);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Auto-lock: count time since the last key press, click or touch.
  useEffect(() => {
    if (!enabled || !autoLock) return;
    const touch = () => (lastActive.current = Date.now());
    touch();
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    if (Platform.OS === "web") events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - lastActive.current > autoLock * 60_000) setLocked(true);
    }, 10_000);
    // Phones: a long time in the background counts as idle too.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && Date.now() - lastActive.current > autoLock * 60_000) setLocked(true);
      if (state !== "active") touch();
    });
    return () => {
      if (Platform.OS === "web") events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, autoLock]);

  const unlock = useCallback(
    async (password: string) => {
      await api.unlock(password);
      lastActive.current = Date.now();
      setLocked(false);
    },
    [api],
  );

  const value = useMemo<LockState>(
    () => ({
      ready,
      enabled,
      locked: enabled && locked,
      lock: () => enabled && setLocked(true),
      unlock,
      setEnabled: (on) => {
        setEnabledState(on);
        if (!on) setLocked(false);
      },
      unlockAfterReset: () => {
        lastActive.current = Date.now();
        setLocked(false);
      },
      autoLock,
      setAutoLock: (minutes) => {
        setAutoLockState(minutes);
        void saveJson(AUTO_LOCK_KEY, minutes);
      },
    }),
    [ready, enabled, locked, unlock, autoLock],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLock(): LockState {
  const value = useContext(Context);
  if (!value) throw new Error("useLock must be used inside LockProvider");
  return value;
}
