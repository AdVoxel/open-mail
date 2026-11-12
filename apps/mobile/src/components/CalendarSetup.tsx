// Connecting an account's calendar (Gmail: Google sign-in, iCloud: on/off),
// shown in Settings and on the Calendar screen.
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import type { AccountCalendarUpdate, AccountInfo, CalendarInfo, GoogleClientStatus } from "@mail-app/api-client";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useApi, useConnection } from "@/src/lib/connection";
import { useMail } from "@/src/lib/mail";
import { ColorDot, LabeledInput, ToggleRow, useNotify } from "./kit";

/**
 * The Google OAuth client the server signs in with (Google only shows its
 * sign-in to registered apps). Saved on the server, secret encrypted.
 */
function GoogleClientForm({ onDone }: { onDone?: () => void }) {
  const api = useApi();
  const notify = useNotify();
  const { refreshCapabilities } = useConnection();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refreshCapabilities();
      notify(done);
      onDone?.();
    } catch (e) {
      const message = (e as Error).message;
      setError(message === "Not found" ? "The server is too old for this: restart it (npm run server) and try again." : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="w-full gap-2">
      <Text size="xs" className="text-muted-foreground">
        Google only shows its sign-in to apps registered with it, so create a client once (about 5 minutes) and paste it here:
      </Text>
      <Text size="xs" className="text-muted-foreground">
        1. console.cloud.google.com → pick or create a project → enable "Google Calendar API".{"\n"}
        2. Google Auth Platform → Get started: Audience Internal (Workspace address) or External, then add yourself under Audience → Test users.{"\n"}
        3. Clients → Create client → Desktop app → copy the client ID and secret.
      </Text>
      <View className="flex-row flex-wrap gap-3">
        <LabeledInput label="Client ID" value={clientId} onChange={setClientId} placeholder="….apps.googleusercontent.com" className="min-w-[240px] flex-1" />
        <LabeledInput label="Client secret" value={secret} onChange={setSecret} placeholder="GOCSPX-…" secure className="min-w-[200px] flex-1" />
      </View>
      {error ? (
        <Text size="xs" className="text-destructive">
          {error}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="rounded-lg"
          disabled={busy || !clientId.trim() || !secret.trim()}
          onPress={() => void run(() => api.saveGoogleClient(clientId.trim(), secret.trim()), "Google client saved: now connect the calendar")}
        >
          <ButtonText>{busy ? "Checking with Google…" : "Save"}</ButtonText>
        </Button>
        {onDone ? (
          <>
            <Button size="sm" variant="ghost" className="rounded-lg" onPress={onDone}>
              <ButtonText>Cancel</ButtonText>
            </Button>
            <Button size="sm" variant="ghost" className="rounded-lg" disabled={busy} onPress={() => void run(() => api.removeGoogleClient(), "Google client removed")}>
              <ButtonText>Remove</ButtonText>
            </Button>
          </>
        ) : null}
      </View>
      <Text size="xs" className="text-muted-foreground">
        Kept on your server with the secret encrypted. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in the server's environment work too and take priority.
      </Text>
    </View>
  );
}

/** Calendar part of an account's settings (Gmail and iCloud). Changes apply right away. */
export function AccountCalendarSettings({ account }: { account: AccountInfo }) {
  const api = useApi();
  const notify = useNotify();
  const { reloadAccounts } = useMail();
  const { capabilities } = useConnection();
  const calendar = account.calendar;
  const [calendars, setCalendars] = useState<CalendarInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changingClient, setChangingClient] = useState(false);
  const [clientStatus, setClientStatus] = useState<GoogleClientStatus | null>(null);

  // Gmail: which Google client the server uses (only one saved from here can be changed here).
  useEffect(() => {
    if (calendar.provider !== "google" || !capabilities?.googleCalendar) return;
    let cancelled = false;
    api.googleClient().then(
      (status) => !cancelled && setClientStatus(status),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [api, calendar.provider, capabilities?.googleCalendar, changingClient]);

  useEffect(() => {
    if (!calendar.enabled) {
      setCalendars(null);
      setError(null);
      return;
    }
    let cancelled = false;
    api.calendars().then(
      (page) => {
        if (cancelled) return;
        setCalendars(page.calendars.filter((c) => c.accountId === account.id));
        setError(page.errors.find((e) => e.accountId === account.id)?.error ?? null);
      },
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [api, account.id, calendar.enabled, calendar.hidden.join("\n")]);

  if (!calendar.provider) return null;

  const run = async (action: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try {
      await action();
      await reloadAccounts();
    } catch (e) {
      notify(failed, (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const update = (change: AccountCalendarUpdate) => run(() => api.updateCalendarSettings(account.id, change), "Couldn't change the calendar settings");

  const connectGoogle = () =>
    run(async () => {
      const { sessionId, url } = await api.connectGoogleCalendar(account.id);
      await Linking.openURL(url);
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await api.googleSignInStatus(sessionId);
        if (status.status === "done") {
          notify("Google Calendar connected", account.address);
          return;
        }
        if (status.status === "error") throw new Error(status.error ?? "Google sign-in failed");
      }
      throw new Error("Google sign-in timed out");
    }, "Couldn't connect Google Calendar");

  const toggleCalendar = (id: string, visible: boolean) =>
    update({ hidden: visible ? calendar.hidden.filter((h) => h !== id) : [...calendar.hidden, id] });

  return (
    <View className="gap-3 rounded-lg border border-border/70 p-3">
      <Text size="sm" className="font-semibold">
        Calendar
      </Text>
      {calendar.provider === "google" && !calendar.connected ? (
        capabilities?.googleCalendar ? (
          <View className="items-start gap-2">
            <Text size="xs" className="text-muted-foreground">
              Gmail calendars need a Google sign-in; the app password only covers mail. Sign in with {account.login || account.address}
              {account.login && account.login.toLowerCase() !== account.address.toLowerCase() ? ` (the account ${account.address} belongs to)` : ""}.
            </Text>
            <Button size="sm" variant="outline" className="rounded-lg" disabled={busy} onPress={() => void connectGoogle()}>
              <ButtonText>{busy ? "Waiting for Google…" : "Connect Google Calendar"}</ButtonText>
            </Button>
            {changingClient ? (
              <GoogleClientForm onDone={() => setChangingClient(false)} />
            ) : clientStatus?.source === "app" ? (
              <Pressable onPress={() => setChangingClient(true)}>
                <Text size="xs" className="text-muted-foreground underline">
                  Use a different Google client
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <GoogleClientForm />
        )
      ) : (
        <>
          <ToggleRow
            label="Show this account's calendars"
            hint={calendar.provider === "icloud" ? "Uses the account's app-specific password." : undefined}
            value={calendar.enabled}
            onChange={(on) => void update({ enabled: on })}
          />
          {calendar.enabled && error ? (
            <Text size="xs" className="text-destructive">
              {error}
            </Text>
          ) : null}
          {calendar.enabled && calendars ? (
            <View className="gap-2">
              {calendars.map((c) => (
                <View key={c.id} className="flex-row items-center gap-2">
                  <ColorDot color={c.color} size={10} />
                  <Text size="sm" numberOfLines={1} className="flex-1">
                    {c.name}
                    {c.readOnly ? <Text size="xs" className="text-muted-foreground">{"  "}read-only</Text> : null}
                  </Text>
                  <Switch size="sm" value={c.visible} disabled={busy} onValueChange={(visible) => void toggleCalendar(c.id, visible)} />
                </View>
              ))}
            </View>
          ) : null}
          {calendar.provider === "google" ? (
            <View className="items-start">
              <Button size="sm" variant="ghost" className="rounded-lg" disabled={busy} onPress={() => void run(() => api.disconnectGoogleCalendar(account.id), "Couldn't disconnect")}>
                <ButtonText>Disconnect Google Calendar</ButtonText>
              </Button>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
