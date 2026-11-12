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
2. `npm run setup`, then open a new terminal. It generates `MAIL_APP_TOKEN` and `MAIL_APP_SECRET_KEY` into `~/.config/open-mail/env` (outside the repo) and loads them from `~/.bashrc`. See [ENVIRONMENT.md](ENVIRONMENT.md).
3. Start the server: `npm run server` (port 8787; data goes to `server/data/`).
4. Start the UI:
   - browser: `npm run web`, then open http://localhost:8081
   - desktop: `npm run web` in one terminal, `npm run desktop` in another
   - phone: `npm run mobile` and open it in Expo Go. Enter your computer's LAN IP on the Connect screen. On WSL2 the phone can't reach the server without port forwarding or mirrored networking.
5. Enter the server address and your `MAIL_APP_TOKEN` on the Connect screen, then open **Settings → Add an account**.

`npm run desktop:build` exports the web UI into `apps/desktop/out/web` and builds the Electron app, which then serves the UI itself.

Development builds default to `http://localhost:8787`; production builds (`npm run desktop:build`) default to `https://apimail.advoxel.com`. Either can be changed in **Settings → Server**, and an address saved there takes precedence over the default.

## Accounts

All providers use IMAP/SMTP with an app password. iCloud has no other API, and this keeps all three working the same way.

- **Gmail**: Google Account → Security → 2-Step Verification → App passwords. "Sign in with Google" is optional (set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, Desktop-app OAuth client with the `https://mail.google.com/` scope). Its redirect goes to `127.0.0.1` on the server, so it only works when the browser runs on the same machine as the server.
- **iCloud**: account.apple.com → Sign-In and Security → App-Specific Passwords. iCloud doesn't keep sent mail, so "Save a copy in Sent" is on by default.
- **Zoho**: enable IMAP in Zoho Mail settings and create an app password (use "Zoho (EU)" for .eu accounts). If sent mail doesn't show up in Sent, turn on "Save a copy in Sent" for that account.

Passwords are encrypted (AES-256-GCM) in `accounts.json` (in `MAIL_APP_DATA_DIR`) with the `MAIL_APP_SECRET_KEY` environment variable. Back up both; never commit them.

## API

Every endpoint except `/api/health` needs `Authorization: Bearer $MAIL_APP_TOKEN`. Message endpoints take `?folder=` (default `INBOX`).

| Method | Path | |
|---|---|---|
| GET | `/api/health` | liveness, no auth |
| GET · PUT · DELETE | `/api/google-client` | Google OAuth client status / save `{clientId, clientSecret}` (checked with Google first; the environment wins) / remove |
| GET | `/api/lock` · PUT · DELETE | screen lock on? / set or change the password (`{password, currentPassword?}`) / turn off (`{password}`) |
| POST | `/api/lock/unlock`, `/api/lock/reset`, `/api/lock/reset/confirm` | check the password / mail a reset code to an account (`{accountId}`) / new password with the code (`{code, password}`) |
| GET | `/api/calendars` | calendars of the accounts with calendars on (`{calendars, errors}`) |
| PATCH | `/api/accounts/:id/calendar` | `{enabled?, hidden?: [calendarId]}` |
| POST · DELETE | `/api/accounts/:id/calendar/google` | Connect Google Calendar (returns a sign-in URL, poll `/api/accounts/google/:session`) / disconnect |
| GET · POST · PATCH · DELETE | `/api/calendar/events` | events in `?from=&to=` (≤100 days) / create `{accountId, calendarId, title, start, end, allDay, location?, description?}` / update (+`eventId`) / delete `?accountId=&calendarId=&eventId=` |
| GET | `/api/events` | server-sent events: `event: mail` with `{message, preview}` when mail arrives in an inbox (checked every 30 s); `event: reminder` with `{event, minutesBefore}` when a calendar alert is due |
| POST | `/api/calendar/events/respond` | answer an invitation: `{accountId, calendarId, eventId, response: "accepted" \| "tentative" \| "declined"}` |
| GET | `/api/capabilities` | server version, Google sign-in available |
| GET / POST | `/api/accounts` | list / add (`{address, password, imap, smtp, name?, label?, saveSentCopy?}`, tested before saving) |
| POST | `/api/accounts/test` | test credentials without saving |
| PATCH / DELETE | `/api/accounts/:id` | label, color (`#rrggbb`), HTML signature, sender name, saveSentCopy / remove |
| POST, GET | `/api/accounts/google`, `/api/accounts/google/:session` | start Google sign-in (returns a URL) / poll it |
| GET | `/api/accounts/:id/folders` | folders with role (inbox, sent, trash…) and unread counts |
| GET | `/api/messages?limit=&mailbox=` | newest mail across all inboxes (`mailbox=sent`: across all Sent folders) |
| GET | `/api/accounts/:id/messages?folder=&limit=&offset=&q=` | list or search (Gmail search syntax on Gmail) |
| GET | `/api/accounts/:id/messages/:uid` | full message: text, html, cc, attachments |
| GET | `/api/accounts/:id/messages/:uid/thread` | the message's conversation, newest first, including replies from Sent |
| GET | `/api/accounts/:id/messages/:uid/attachments/:index` | download an attachment |
| GET | `/api/accounts/:id/messages/:uid/attachments` | every attachment in one ZIP |
| GET | `/api/tracking?messageId=` | opens of tracked sent mail (send with `track: true`) |
| GET | `/t/:id.gif` | the open-tracking image (public, no token); recipients' apps load it |
| PATCH | `/api/accounts/:id/messages/:uid` | `{seen?, flagged?, answered?, labels?: {<labelId>: true \| false}}` (labels are IMAP keywords `$OpenMail_<labelId>`) |
| GET / POST | `/api/labels` | list / create a label (`{name, color}`) |
| PATCH / DELETE | `/api/labels/:lid` | rename or recolor / delete a label |
| POST | `/api/accounts/:id/messages/:uid/move` | `{to: "archive" \| "trash" \| "junk" \| "inbox" \| <folder path>}` |
| DELETE | `/api/accounts/:id/messages/:uid` | move to Trash (permanent if already in Trash) |
| POST | `/api/accounts/:id/send` | `{to, cc?, bcc?, subject, text, html?, inReplyTo?, references?, attachments?: [{filename, contentType?, content: base64}], signature?, sendAt?}` (`signature: true` adds the account's signature); a future `sendAt` schedules it |
| POST | `/api/accounts/:id/drafts` | save a draft to the Drafts folder (`{…mail, replace?: {folder, uid}}` replaces the previous copy) → `{folder, uid}` |
| DELETE | `/api/accounts/:id/drafts/:uid?folder=` | delete a draft for good |
| GET / POST | `/api/scheduled` | list / schedule (`{accountId, sendAt, …mail}`) |
| GET / PATCH / DELETE | `/api/scheduled/:id` | read / edit or reschedule / cancel |
| POST | `/api/scheduled/:id/send` | send now (also retries a failed one) |

Scheduled mail is stored in `server/data/scheduled.json` and sent by the server, so it goes out even when every app is closed. Failed sends are retried 3 times. A send interrupted by a restart is marked failed rather than resent, so nothing goes out twice.

## Raspberry Pi (production: https://apimail.advoxel.com)

Copy the repo, run `npm install`, then `sudo ./scripts/setup-env.sh /etc/open-mail/env`, and run `npm run server` under systemd with `Restart=always`. Keep the keys in a root-only file outside the repo (`EnvironmentFile=/etc/open-mail/env`) and point `MAIL_APP_DATA_DIR` outside the repo too. Serve it over HTTPS at `apimail.advoxel.com` with a reverse proxy to `127.0.0.1:8787` (set `MAIL_APP_HOST=127.0.0.1`), since the API is plain HTTP.
