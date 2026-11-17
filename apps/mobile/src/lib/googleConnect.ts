import { Linking } from "react-native";
import type { useApi } from "./connection";

/**
 * Google sign-in for a Gmail account's calendar and contacts: opens Google's
 * page, then waits for the server to finish. Connecting again replaces the
 * old permission (how an account picks up contacts access).
 */
export async function connectGoogle(api: ReturnType<typeof useApi>, accountId: string): Promise<void> {
  const { sessionId, url } = await api.connectGoogleCalendar(accountId);
  await Linking.openURL(url);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await api.googleSignInStatus(sessionId);
    if (status.status === "done") return;
    if (status.status === "error") throw new Error(status.error ?? "Google sign-in failed");
  }
  throw new Error("Google sign-in timed out");
}
