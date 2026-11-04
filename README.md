# Mail

A personal mail client for Gmail, iCloud and Zoho with AI triage and reply drafting.

- **Desktop (Electron)**: `apps/desktop`. Its main process connects to your mailboxes over IMAP/SMTP, calls Claude, and serves a local API on port 8787.
- **Mobile (Expo / React Native)**: `apps/mobile`. A thin client for that local API over your Wi-Fi. No keys or passwords live on the phone.
- **AI**: by default Claude Haiku 5.5 triages every email (category, priority, summary, action items) and Claude Sonnet 5.5 drafts replies only when you ask. Either job can be switched to OpenAI, Gemini, a local Ollama model, or any OpenAI-compatible API in **Settings → AI engines**.

```
packages/core        AI calls + IMAP/SMTP (Node only)
packages/api-client  typed fetch client shared by both apps
apps/server          local HTTP API (embedded in desktop, or run standalone)
apps/desktop         Electron + React
apps/mobile          Expo + React Native
```

## Setup

1. `npm install` (then `node node_modules/electron/install.js` if Electron's binary didn't download).
2. Copy `.env.example` to `.env` and set `MAIL_APP_TOKEN` (and `ANTHROPIC_API_KEY`, or save a key in Settings later).
3. Desktop: `npm run desktop`, then open **Settings** to add accounts.
4. Mobile: copy `apps/mobile/.env.example` to `apps/mobile/.env.local`, set your computer's Wi-Fi IP and the same token, then `npm run mobile` and scan the QR code with Expo Go.

Without the desktop app open, `npm run server` runs the API alone.

## Adding accounts

**Settings → Add an account** has presets for Gmail, iCloud, Zoho (.com and EU) and Outlook, plus **Other (custom servers)** where you enter your own IMAP/SMTP host, port and security (SSL/TLS or STARTTLS). "Test connection" logs in without saving. Passwords are encrypted with the macOS Keychain (`config.json` in the app's data folder) and never sent to the phone.

- **iCloud** only supports app-specific passwords (account.apple.com → Sign-In and Security). If login fails with your full address, open "Edit server settings" and set the username to the part before the `@`.
- **Gmail** works with an app password (needs 2-Step Verification), or with Google sign-in below.

### Google sign-in (optional)

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Gmail API**.
2. Under **Google Auth Platform**, set up the consent screen as **External**, add your Gmail address as a **test user**, and add the scope `https://mail.google.com/`.
3. Under **Clients**, create an OAuth client of type **Desktop app**.
4. Put its client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and restart the app.

While the Google project is in "Testing" status, Google expires the sign-in after 7 days, so you'd need to remove and re-add the account weekly. An app password doesn't expire.

## AI engines

Triage and drafting each have their own provider, model and API key (**Settings → AI engines**):

| Provider | Base URL | Notes |
|---|---|---|
| Claude | — | Haiku 5.5 / Sonnet 5.5 / Opus 5.5 |
| OpenAI | `https://api.openai.com/v1` | needs an API key |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | needs an API key |
| Ollama | `http://localhost:11434/v1` | free and local; run `ollama pull <model>` first |
| Other | your own | any API that implements `/chat/completions` |

Non-Claude models must support JSON-schema structured output for triage. Most current OpenAI and Gemini models do; small local models may not.

## Cost notes

- Each email is triaged once per run (cached in memory) at effort `low`.
- Drafting with Sonnet happens only on demand.
- Triage results are not saved to disk yet, so restarting re-triages the inbox.
