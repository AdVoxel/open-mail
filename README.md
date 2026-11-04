# Mail

A personal mail client for Gmail, iCloud and Zoho, without AI. One always-on server (e.g. a Raspberry Pi) holds the accounts and talks IMAP/SMTP to the providers; the desktop and mobile apps only talk to that server.

```
apps (desktop / phone / browser) ──HTTP + token──▶ server ──IMAP/SMTP──▶ Gmail · iCloud · Zoho
```

```
server               the mail server: accounts, IMAP/SMTP, scheduled sending, HTTP API
packages/core        mail logic used by the server (Node only)
packages/api-client  typed fetch client for the API, shared by the apps
apps/mobile          the UI: Expo + gluestack-ui (iOS, Android and web)
apps/desktop         Electron window around the web build of apps/mobile
```

## Run it locally

1. `npm install` (if Electron's binary didn't download: `node node_modules/electron/install.js`).
2. `cp .env.example .env` and set `MAIL_APP_TOKEN` to a random string.
3. `cp apps/mobile/.env.example apps/mobile/.env.local` and put the same token there.
4. Start the server: `npm run server` (port 8787; data goes to `server/data/`).
5. Start the UI:
   - browser: `npm run web`, then open http://localhost:8081
   - desktop: `npm run web` in one terminal, `npm run desktop` in another
   - phone: `npm run mobile` and open it in Expo Go. Set `EXPO_PUBLIC_MAIL_API_URL` to your computer's LAN IP. On WSL2 the phone can't reach the server without port forwarding or mirrored networking.
6. Open **Settings → Add an account**.

`npm run desktop:build` exports the web UI into `apps/desktop/out/web` and builds the Electron app, which then serves the UI itself.

Values in `apps/mobile/.env.local` are only defaults: the server address and token can be changed in **Settings → Server**, which is how you'll point the apps at the Raspberry Pi later.

## Accounts

All providers use IMAP/SMTP with an app password. iCloud has no other API, and this keeps all three working the same way.

- **Gmail**: Google Account → Security → 2-Step Verification → App passwords. "Sign in with Google" is optional (set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, Desktop-app OAuth client with the `https://mail.google.com/` scope). Its redirect goes to `127.0.0.1` on the server, so it only works when the browser runs on the same machine as the server.
- **iCloud**: account.apple.com → Sign-In and Security → App-Specific Passwords. iCloud doesn't keep sent mail, so "Save a copy in Sent" is on by default.
- **Zoho**: enable IMAP in Zoho Mail settings and create an app password (use "Zoho (EU)" for .eu accounts). If sent mail doesn't show up in Sent, turn on "Save a copy in Sent" for that account.

Passwords are encrypted (AES-256-GCM) in `server/data/accounts.json` with the key in `server/data/secret.key`, or `MAIL_APP_SECRET_KEY`. Back up both; never commit them.

## API

Every endpoint except `/api/health` needs `Authorization: Bearer $MAIL_APP_TOKEN`. Message endpoints take `?folder=` (default `INBOX`).

| Method | Path | |
|---|---|---|
| GET | `/api/health` | liveness, no auth |
| GET | `/api/capabilities` | server version, Google sign-in available |
| GET / POST | `/api/accounts` | list / add (`{address, password, imap, smtp, name?, label?, saveSentCopy?}`, tested before saving) |
| POST | `/api/accounts/test` | test credentials without saving |
| PATCH / DELETE | `/api/accounts/:id` | rename, sender name, saveSentCopy / remove |
| POST, GET | `/api/accounts/google`, `/api/accounts/google/:session` | start Google sign-in (returns a URL) / poll it |
| GET | `/api/accounts/:id/folders` | folders with role (inbox, sent, trash…) and unread counts |
| GET | `/api/messages?limit=` | newest mail across all inboxes |
| GET | `/api/accounts/:id/messages?folder=&limit=&offset=&q=` | list or search (Gmail search syntax on Gmail) |
| GET | `/api/accounts/:id/messages/:uid` | full message: text, html, cc, attachments |
| GET | `/api/accounts/:id/messages/:uid/attachments/:index` | download an attachment |
| PATCH | `/api/accounts/:id/messages/:uid` | `{seen?, flagged?, answered?}` |
| POST | `/api/accounts/:id/messages/:uid/move` | `{to: "archive" \| "trash" \| "junk" \| "inbox" \| <folder path>}` |
| DELETE | `/api/accounts/:id/messages/:uid` | move to Trash (permanent if already in Trash) |
| POST | `/api/accounts/:id/send` | `{to, cc?, bcc?, subject, text, html?, inReplyTo?, references?, attachments?: [{filename, contentType?, content: base64}], sendAt?}`; a future `sendAt` schedules it |
| GET / POST | `/api/scheduled` | list / schedule (`{accountId, sendAt, …mail}`) |
| GET / PATCH / DELETE | `/api/scheduled/:id` | read / edit or reschedule / cancel |
| POST | `/api/scheduled/:id/send` | send now (also retries a failed one) |

Scheduled mail is stored in `server/data/scheduled.json` and sent by the server, so it goes out even when every app is closed. Failed sends are retried 3 times. A send interrupted by a restart is marked failed rather than resent, so nothing goes out twice.

## Raspberry Pi (later)

Copy the repo, run `npm install`, create `.env`, and run `npm run server` under systemd with `Restart=always`. Then set the Pi's address in each app's **Settings → Server**. Use HTTPS (e.g. Tailscale or a reverse proxy) before exposing it beyond your home network.
