import { useEffect, useState } from "react";
import { Settings } from "./Settings";
import {
  messageKey as key,
  replyFields,
  triageInBackground,
  type AccountId,
  type AccountInfo,
  type MailApi,
  type MailMessage,
  type MessageHeader,
  type TriageState,
} from "@mail-app/api-client";

export function App({ api }: { api: MailApi }) {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [accountId, setAccountId] = useState<AccountId | null>(null);
  const [headers, setHeaders] = useState<MessageHeader[]>([]);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [triage, setTriage] = useState<Record<string, TriageState>>({});
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"mail" | "settings">("mail");

  function loadAccounts() {
    api
      .accounts()
      .then((list) => {
        setAccounts(list);
        setAccountId((current) => (list.some((a) => a.id === current) ? current : (list[0]?.id ?? null)));
        if (list.length === 0) setView("settings");
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }

  useEffect(loadAccounts, [api]);

  useEffect(() => {
    if (!accountId) return;
    setHeaders([]);
    setSelectedUid(null);
    api.inbox(accountId).then(setHeaders, (e: Error) => setError(e.message));
  }, [api, accountId]);

  // Triage the visible inbox with Haiku, a few requests at a time.
  useEffect(
    () =>
      triageInBackground(
        api,
        headers.filter((h) => !triage[key(h)]),
        (k, state) => setTriage((t) => ({ ...t, [k]: state })),
      ),
    // Re-run only when the list changes; `triage` is read just to skip finished rows.
    [api, headers],
  );

  const selected = headers.find((h) => h.uid === selectedUid);

  return (
    <div className="layout">
      <nav className="accounts">
        <h1>Mail</h1>
        {accounts.map((a) => (
          <button
            key={a.id}
            className={view === "mail" && a.id === accountId ? "account active" : "account"}
            onClick={() => {
              setAccountId(a.id);
              setView("mail");
            }}
          >
            <strong>{a.label}</strong>
            <span>{a.address}</span>
          </button>
        ))}
        <button
          className={view === "settings" ? "account active settings-link" : "account settings-link"}
          onClick={() => setView("settings")}
        >
          <strong>Settings</strong>
          <span>Accounts and AI</span>
        </button>
      </nav>

      {view === "settings" ? (
        <main className="reader wide">
          {error && <p className="error">{error}</p>}
          <Settings api={api} accounts={accounts} onAccountsChanged={loadAccounts} />
        </main>
      ) : (
        <>
          <section className="inbox">
            {error && <p className="error">{error}</p>}
            {headers.map((h) => {
              const t = triage[key(h)];
              return (
                <button
                  key={h.uid}
                  className={`row ${h.uid === selectedUid ? "selected" : ""} ${h.seen ? "" : "unread"}`}
                  onClick={() => setSelectedUid(h.uid)}
                >
                  <div className="row-top">
                    <span className="from">{h.from}</span>
                    <span className="date">{new Date(h.date).toLocaleDateString()}</span>
                  </div>
                  <div className="subject">{h.subject}</div>
                  <TriageLine state={t} />
                </button>
              );
            })}
          </section>

          <main className="reader">
            {selected ? (
              <MessageView key={key(selected)} api={api} header={selected} triage={triage[key(selected)]} />
            ) : (
              <p className="muted center">Select a message</p>
            )}
          </main>
        </>
      )}
    </div>
  );
}

function TriageLine({ state }: { state: TriageState | undefined }) {
  if (!state || state === "loading") return <div className="triage muted">Summarizing…</div>;
  if (state === "error") return <div className="triage muted">Summary unavailable</div>;
  return (
    <div className="triage">
      <span className={`badge ${state.priority}`}>{state.priority}</span>
      <span className="badge">{state.category}</span>
      <span className="summary">{state.summary}</span>
    </div>
  );
}

function MessageView({
  api,
  header,
  triage,
}: {
  api: MailApi;
  header: MessageHeader;
  triage: TriageState | undefined;
}) {
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [instructions, setInstructions] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"drafting" | "sending" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api.message(header.accountId, header.uid).then(setMessage, (e: Error) => setStatus(e.message));
  }, [api, header]);

  async function generateDraft() {
    setBusy("drafting");
    setStatus(null);
    try {
      setDraft(await api.draft(header.accountId, header.uid, instructions || undefined));
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function sendReply() {
    if (!message || !draft.trim()) return;
    if (!window.confirm(`Send this reply to ${message.from}?`)) return;
    setBusy("sending");
    try {
      await api.send(header.accountId, replyFields(message, draft));
      setDraft("");
      setStatus("Reply sent.");
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!message) return <p className="muted center">{status ?? "Loading…"}</p>;

  return (
    <article>
      <h2>{message.subject}</h2>
      <p className="meta">
        {message.from} · {new Date(message.date).toLocaleString()}
      </p>

      {triage && typeof triage === "object" && (
        <div className="ai-box">
          <p>{triage.summary}</p>
          {triage.action_items.length > 0 && (
            <ul>
              {triage.action_items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <pre className="body">{message.body}</pre>

      <div className="composer">
        <input
          placeholder="How should I reply? (optional, e.g. “accept, suggest Thursday”)"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
        <button onClick={generateDraft} disabled={busy !== null}>
          {busy === "drafting" ? "Drafting…" : "Draft reply with AI"}
        </button>
        {draft && (
          <>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} />
            <button className="primary" onClick={sendReply} disabled={busy !== null}>
              {busy === "sending" ? "Sending…" : "Send"}
            </button>
          </>
        )}
        {status && <p className="status">{status}</p>}
      </div>
    </article>
  );
}
