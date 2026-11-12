import { useCallback, useEffect, useState } from "react";
import { loadJson, saveJson } from "./storage";

const STORAGE_KEY = "mail.sendDelay";

/** Seconds every sent message waits (with Undo) before it goes out. 0 = off. */
export const SEND_DELAYS = [0, 30, 60, 90, 120] as const;
export type SendDelay = (typeof SEND_DELAYS)[number];

/** The send delay set on this device. */
export function useSendDelay(): [SendDelay, (delay: SendDelay) => void] {
  const [delay, setDelayState] = useState<SendDelay>(0);
  useEffect(() => {
    void loadJson<number>(STORAGE_KEY).then((saved) => {
      if (SEND_DELAYS.includes(saved as SendDelay)) setDelayState(saved as SendDelay);
    });
  }, []);
  const setDelay = useCallback((next: SendDelay) => {
    setDelayState(next);
    void saveJson(STORAGE_KEY, next);
  }, []);
  return [delay, setDelay];
}
