import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { createMailApi, type Capabilities, type MailApi } from "@mail-app/api-client";
import { loadJson, saveJson } from "./storage";

export interface ServerConnection {
  url: string;
  token: string;
}

type Status = "loading" | "connected" | "offline" | "unconfigured";

interface ConnectionState {
  status: Status;
  connection: ServerConnection | null;
  api: MailApi | null;
  capabilities: Capabilities | null;
  error: string | null;
  /** Test a server and save it on success. Throws the connection error. */
  connect: (connection: ServerConnection) => Promise<void>;
  retry: () => void;
  /** Reads the server's capabilities again (after a setting changed them), without reconnecting. */
  refreshCapabilities: () => Promise<void>;
}

const STORAGE_KEY = "mail.connection";
const Context = createContext<ConnectionState | null>(null);

/** Production server. Development builds talk to a server on this machine instead. */
export const PRODUCTION_SERVER_URL = "https://apimail.advoxel.com";
const DEVELOPMENT_SERVER_URL = "http://localhost:8787";

/** The address offered before one is saved. The token is never bundled: it is entered on the Connect screen. */
export function defaultServerUrl(): string {
  if (!__DEV__) return PRODUCTION_SERVER_URL;
  return Platform.OS === "web" ? DEVELOPMENT_SERVER_URL : "";
}

function defaultConnection(): ServerConnection {
  return { url: defaultServerUrl(), token: "" };
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<ServerConnection | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const api = useMemo(() => (connection ? createMailApi(connection.url, connection.token) : null), [connection]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = (await loadJson<ServerConnection>(STORAGE_KEY)) ?? defaultConnection();
      if (cancelled) return;
      setConnection(saved);
      if (!saved.url || !saved.token) {
        setStatus("unconfigured");
        return;
      }
      setStatus("loading");
      try {
        const caps = await createMailApi(saved.url, saved.token).capabilities();
        if (cancelled) return;
        setCapabilities(caps);
        setError(null);
        setStatus("connected");
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setStatus("offline");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const connect = useCallback(async (next: ServerConnection) => {
    const clean = { url: next.url.trim().replace(/\/+$/, ""), token: next.token.trim() };
    const caps = await createMailApi(clean.url, clean.token).capabilities();
    await saveJson(STORAGE_KEY, clean);
    setConnection(clean);
    setCapabilities(caps);
    setError(null);
    setStatus("connected");
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const refreshCapabilities = useCallback(async () => {
    if (api) setCapabilities(await api.capabilities());
  }, [api]);

  const value = useMemo(
    () => ({ status, connection, api, capabilities, error, connect, retry, refreshCapabilities }),
    [status, connection, api, capabilities, error, connect, retry, refreshCapabilities],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConnection(): ConnectionState {
  const value = useContext(Context);
  if (!value) throw new Error("useConnection must be used inside ConnectionProvider");
  return value;
}

/** The API client; only call below the connection gate. */
export function useApi(): MailApi {
  const { api } = useConnection();
  if (!api) throw new Error("Not connected to a mail server");
  return api;
}
