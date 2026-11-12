import { useCallback, useEffect, useState } from "react";
import { loadJson, saveJson } from "./storage";

/** A preference kept on this device. */
function usePreference<T>(key: string, fallback: T, valid: (value: unknown) => boolean): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    void loadJson<T>(key).then((saved) => saved !== null && valid(saved) && setValue(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (next: T) => {
      setValue(next);
      void saveJson(key, next);
    },
    [key],
  );
  return [value, set];
}

/** Save what's being written to the account's Drafts folder as you go. */
export function useAutoDrafts(): [boolean, (on: boolean) => void] {
  return usePreference("mail.autoDrafts", true, (v) => typeof v === "boolean");
}

/** Add the open-tracking pixel to new messages (each can be changed in Compose). */
export function useTrackOpens(): [boolean, (on: boolean) => void] {
  return usePreference("mail.trackOpens", true, (v) => typeof v === "boolean");
}

export type SignaturePosition = "before-quote" | "end";

/** In replies and forwards: the signature above the quoted message, or at the very end. */
export function useSignaturePosition(): [SignaturePosition, (position: SignaturePosition) => void] {
  return usePreference<SignaturePosition>("mail.signaturePosition", "before-quote", (v) => v === "before-quote" || v === "end");
}
