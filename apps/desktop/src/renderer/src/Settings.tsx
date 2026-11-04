import { useEffect, useState } from "react";
import {
  AI_PRESETS,
  CLAUDE_MODELS,
  MAIL_PRESETS,
  type AccountInfo,
  type AccountInput,
  type AiJob,
  type AiRoute,
  type AiSettingsView,
  type Capabilities,
  type HostConfig,
  type MailApi,
} from "@mail-app/api-client";

export function Settings({
  api,
  accounts,
  onAccountsChanged,
}: {
  api: MailApi;
  accounts: AccountInfo[];
  onAccountsChanged: () => void;
}) {
  const [caps, setCaps] = useState<Capabilities | null>(null);

  useEffect(() => {
    api.capabilities().then(setCaps, () => setCaps(null));
  }, [api]);

  return (
    <div className="settings">
      <h2>Accounts</h2>
      <AccountList api={api} accounts={accounts} onChanged={onAccountsChanged} />
      {caps?.manageAccounts && (
        <>
          <GoogleSignIn api={api} enabled={caps.googleSignIn} onAdded={onAccountsChanged} />
          <AddAccountForm api={api} onAdded={onAccountsChanged} />
        </>
      )}

      <h2>AI engines</h2>
      <p className="muted">
        Triage runs on every email, so a cheap model fits best. Drafting runs only when you ask for a reply.
      </p>
      {caps?.editAiSettings ? <AiSettingsForm api={api} /> : <p className="muted">Open the desktop app to change AI settings.</p>}
    </div>
  );
}

function AccountList({ api, accounts, onChanged }: { api: MailApi; accounts: AccountInfo[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function remove(account: AccountInfo) {
    if (!window.confirm(`Remove ${account.address} from Mail? (Nothing is deleted from the mailbox.)`)) return;
    try {
      await api.removeAccount(account.id);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card">
      {accounts.length === 0 && <p className="muted">No accounts yet.</p>}
      {accounts.map((a) => (
        <div key={a.id} className="account-row">
          <div>
            <strong>{a.label}</strong>
            <span className="muted">
              {" "}
              {a.address} · {a.authType === "google" ? "Google sign-in" : "password"}
              {a.source === "env" && " · from .env"}
            </span>
          </div>
          {a.source === "app" && <button onClick={() => remove(a)}>Remove</button>}
        </div>
      ))}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function GoogleSignIn({ api, enabled, onAdded }: { api: MailApi; enabled: boolean; onAdded: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setStatus("Finish signing in to Google in your browser…");
    try {
      const account = await api.addGoogleAccount();
      setStatus(`Added ${account.address}.`);
      onAdded();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Gmail with Google sign-in</h3>
      {enabled ? (
        <button className="primary" onClick={signIn} disabled={busy}>
          {busy ? "Waiting for Google…" : "Sign in with Google"}
        </button>
      ) : (
        <p className="muted">
          Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env to enable this (README has the steps). You can still add
          Gmail below with an app password.
        </p>
      )}
      {status && <p className="status">{status}</p>}
    </div>
  );
}

const CUSTOM = "custom";

function AddAccountForm({ api, onAdded }: { api: MailApi; onAdded: () => void }) {
  const [presetId, setPresetId] = useState(MAIL_PRESETS[0]!.id);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [user, setUser] = useState("");
  const [imap, setImap] = useState<HostConfig>(MAIL_PRESETS[0]!.imap);
  const [smtp, setSmtp] = useState<HostConfig>(MAIL_PRESETS[0]!.smtp);
  const [showServers, setShowServers] = useState(false);
  const [busy, setBusy] = useState<"testing" | "adding" | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const preset = MAIL_PRESETS.find((p) => p.id === presetId);

  function choosePreset(id: string) {
    setPresetId(id);
    const p = MAIL_PRESETS.find((m) => m.id === id);
    setImap(p?.imap ?? { host: "", port: 993, secure: true });
    setSmtp(p?.smtp ?? { host: "", port: 587, secure: false });
    setShowServers(id === CUSTOM);
    setStatus(null);
  }

  const input: AccountInput = { label: label || undefined, address, user: user || undefined, password, imap, smtp };

  async function run(kind: "testing" | "adding") {
    setBusy(kind);
    setStatus(null);
    try {
      if (kind === "testing") {
        await api.testAccount(input);
        setStatus({ ok: true, text: "Connection works." });
      } else {
        const account = await api.addAccount(input);
        setStatus({ ok: true, text: `Added ${account.address}.` });
        setPassword("");
        setAddress("");
        setLabel("");
        setUser("");
        onAdded();
      }
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <form className="card form" onSubmit={(e) => (e.preventDefault(), void run("adding"))}>
      <h3>Add an account (IMAP/SMTP)</h3>
      <label>
        Provider
        <select value={presetId} onChange={(e) => choosePreset(e.target.value)}>
          {MAIL_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM}>Other (custom servers)</option>
        </select>
      </label>
      {preset && <p className="muted">{preset.help}</p>}
      <label>
        Email address
        <input type="email" required value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label>
        Password / app password
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>
        Name in the sidebar (optional)
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={address || "Work"} />
      </label>

      {presetId !== CUSTOM && (
        <button type="button" className="link" onClick={() => setShowServers((s) => !s)}>
          {showServers ? "Hide server settings" : "Edit server settings"}
        </button>
      )}
      {showServers && (
        <>
          <label>
            Username (if different from the email address)
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder={address} />
          </label>
          <ServerFields title="Incoming (IMAP)" value={imap} onChange={setImap} />
          <ServerFields title="Outgoing (SMTP)" value={smtp} onChange={setSmtp} />
        </>
      )}

      <div className="buttons">
        <button type="button" onClick={() => run("testing")} disabled={busy !== null || !address || !password}>
          {busy === "testing" ? "Testing…" : "Test connection"}
        </button>
        <button type="submit" className="primary" disabled={busy !== null || !address || !password}>
          {busy === "adding" ? "Connecting…" : "Add account"}
        </button>
      </div>
      {status && <p className={status.ok ? "status" : "error"}>{status.text}</p>}
      <p className="muted">Passwords are encrypted with your macOS Keychain and never sent to the phone.</p>
    </form>
  );
}

function ServerFields({ title, value, onChange }: { title: string; value: HostConfig; onChange: (v: HostConfig) => void }) {
  return (
    <fieldset>
      <legend>{title}</legend>
      <input
        placeholder="mail.example.com"
        required
        value={value.host}
        onChange={(e) => onChange({ ...value, host: e.target.value })}
      />
      <input
        type="number"
        className="port"
        required
        value={value.port}
        onChange={(e) => onChange({ ...value, port: Number(e.target.value) })}
      />
      <select
        value={value.secure ? "tls" : "starttls"}
        onChange={(e) => onChange({ ...value, secure: e.target.value === "tls" })}
      >
        <option value="tls">SSL/TLS</option>
        <option value="starttls">STARTTLS</option>
      </select>
    </fieldset>
  );
}

function AiSettingsForm({ api }: { api: MailApi }) {
  const [settings, setSettings] = useState<AiSettingsView | null>(null);

  useEffect(() => {
    api.aiSettings().then(setSettings, () => setSettings(null));
  }, [api]);

  if (!settings) return <p className="muted">Loading…</p>;
  return (
    <>
      <AiJobForm api={api} job="triage" title="Triage (every email)" initial={settings.triage} />
      <AiJobForm api={api} job="draft" title="Reply drafts (on demand)" initial={settings.draft} />
    </>
  );
}

function presetFor(route: AiRoute): string {
  if (route.provider === "anthropic") return "anthropic";
  return AI_PRESETS.find((p) => p.baseUrl && p.baseUrl === route.baseUrl)?.id ?? "custom";
}

function AiJobForm({
  api,
  job,
  title,
  initial,
}: {
  api: MailApi;
  job: AiJob;
  title: string;
  initial: { route: AiRoute; hasApiKey: boolean };
}) {
  const [presetId, setPresetId] = useState(presetFor(initial.route));
  const [model, setModel] = useState(initial.route.model);
  const [baseUrl, setBaseUrl] = useState(initial.route.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(initial.hasApiKey);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const preset = AI_PRESETS.find((p) => p.id === presetId)!;

  function choosePreset(id: string) {
    const next = AI_PRESETS.find((p) => p.id === id)!;
    setPresetId(id);
    setBaseUrl(next.baseUrl ?? "");
    setModel(next.provider === "anthropic" ? (job === "triage" ? "claude-haiku-5-5" : "claude-sonnet-5-5") : "");
    setStatus(null);
  }

  async function save(clearKey = false) {
    setStatus(null);
    const route: AiRoute =
      preset.provider === "anthropic" ? { provider: "anthropic", model } : { provider: "openai-compatible", model, baseUrl };
    try {
      await api.setAiSettings(job, route, clearKey ? "" : apiKey || undefined);
      if (clearKey) setHasKey(false);
      else if (apiKey) setHasKey(true);
      setApiKey("");
      setStatus({ ok: true, text: "Saved." });
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    }
  }

  const keyPlaceholder = hasKey
    ? "Saved. Leave blank to keep it"
    : preset.provider === "anthropic"
      ? "Leave blank to use ANTHROPIC_API_KEY from .env"
      : preset.needsKey
        ? "Required"
        : "Not needed";

  return (
    <form className="card form" onSubmit={(e) => (e.preventDefault(), void save())}>
      <h3>{title}</h3>
      <label>
        Provider
        <select value={presetId} onChange={(e) => choosePreset(e.target.value)}>
          {AI_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model
        {preset.provider === "anthropic" ? (
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {CLAUDE_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input required value={model} onChange={(e) => setModel(e.target.value)} placeholder={preset.modelHint} />
        )}
      </label>
      {preset.provider === "openai-compatible" && (
        <label>
          Base URL
          <input
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            readOnly={presetId !== "custom"}
            placeholder="https://api.example.com/v1"
          />
        </label>
      )}
      <label>
        API key
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyPlaceholder} />
      </label>
      <div className="buttons">
        <button type="submit" className="primary">
          Save
        </button>
        {hasKey && (
          <button type="button" onClick={() => save(true)}>
            Remove saved key
          </button>
        )}
      </div>
      {status && <p className={status.ok ? "status" : "error"}>{status.text}</p>}
    </form>
  );
}
