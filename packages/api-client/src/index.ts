// Browser/React Native-safe client for the local mail API. Only *types* come
// from @mail-app/core, so none of its Node code ends up in the app bundles.
import type {
  AccountId,
  AccountInfo,
  AccountInput,
  AiJob,
  AiRoute,
  MailMessage,
  MessageHeader,
  Triage,
} from "@mail-app/core";

// Presets are plain data, safe to bundle into the apps.
export * from "@mail-app/core/presets";
export type { AccountId, AccountInfo, AccountInput, AiJob, AiRoute, MailMessage, MessageHeader, Triage };

export interface Capabilities {
  manageAccounts: boolean;
  googleSignIn: boolean;
  editAiSettings: boolean;
}

export type AiSettingsView = Record<AiJob, { route: AiRoute; hasApiKey: boolean }>;

export interface ReplyInput {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string[];
}

export class MailApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function createMailApi(baseUrl: string, token: string) {
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await fetch(`${root}/api${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new MailApiError(res.status, data.error ?? `HTTP ${res.status}`);
    return data as T;
  }

  return {
    capabilities: () => request<Capabilities>("/capabilities"),
    accounts: () => request<AccountInfo[]>("/accounts"),
    testAccount: (input: AccountInput) =>
      request<{ ok: true }>("/accounts/test", { method: "POST", body: input }),
    addAccount: (input: AccountInput) => request<AccountInfo>("/accounts", { method: "POST", body: input }),
    /** Opens Google sign-in in the browser on the computer and waits for it to finish. */
    addGoogleAccount: () => request<AccountInfo>("/accounts/google", { method: "POST", body: {} }),
    removeAccount: (accountId: AccountId) =>
      request<{ ok: true }>(`/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" }),
    aiSettings: () => request<AiSettingsView>("/settings/ai"),
    /** `apiKey`: omit to keep the saved key, "" to remove it. */
    setAiSettings: (job: AiJob, route: AiRoute, apiKey?: string) =>
      request<{ ok: true }>(`/settings/ai/${job}`, { method: "PUT", body: { route, apiKey } }),
    inbox: (accountId: AccountId, limit = 30) =>
      request<MessageHeader[]>(`/accounts/${accountId}/messages?limit=${limit}`),
    message: (accountId: AccountId, uid: number) =>
      request<MailMessage>(`/accounts/${accountId}/messages/${uid}`),
    triage: (accountId: AccountId, uid: number) =>
      request<Triage>(`/accounts/${accountId}/messages/${uid}/triage`),
    draft: (accountId: AccountId, uid: number, instructions?: string) =>
      request<{ draft: string }>(`/accounts/${accountId}/messages/${uid}/draft`, {
        method: "POST",
        body: { instructions },
      }).then((r) => r.draft),
    send: (accountId: AccountId, mail: ReplyInput) =>
      request<{ ok: true }>(`/accounts/${accountId}/send`, { method: "POST", body: mail }),
  };
}

export type MailApi = ReturnType<typeof createMailApi>;

export type TriageState = Triage | "loading" | "error";

export function messageKey(h: { accountId: AccountId; uid: number }): string {
  return `${h.accountId}:${h.uid}`;
}

/**
 * Triage messages with Haiku a few at a time, reporting each result as it lands.
 * Returns a cancel function; requests already in flight still report their result.
 */
export function triageInBackground(
  api: MailApi,
  headers: MessageHeader[],
  onUpdate: (key: string, state: TriageState) => void,
  concurrency = 3,
): () => void {
  let cancelled = false;
  const queue = [...headers];
  async function worker() {
    for (let h = queue.shift(); h && !cancelled; h = queue.shift()) {
      const key = messageKey(h);
      onUpdate(key, "loading");
      onUpdate(key, await api.triage(h.accountId, h.uid).catch((): TriageState => "error"));
    }
  }
  for (let i = 0; i < concurrency; i++) void worker();
  return () => {
    cancelled = true;
  };
}

/** Build the reply fields (Re: subject, threading headers) for a message. */
export function replyFields(message: MailMessage, body: string): ReplyInput {
  return {
    to: message.from,
    subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
    body,
    inReplyTo: message.messageId,
    references: message.messageId ? [...message.references, message.messageId] : message.references,
  };
}
