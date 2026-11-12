# Environment variables

The server reads all of its keys from the process environment. It doesn't load a `.env` file, and it never writes keys to disk. Never commit values for these variables to the repository.

## Required

| Variable | What it is | How to generate |
| --- | --- | --- |
| `MAIL_APP_TOKEN` | Shared secret the apps send as `Authorization: Bearer <token>`. Enter the same value on the app's Connect screen. | `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` |
| `MAIL_APP_SECRET_KEY` | 32-byte key, base64-encoded, that encrypts the account passwords saved in `accounts.json`. Losing it means adding every account again. | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

## Optional

| Variable | Default | What it is |
| --- | --- | --- |
| `MAIL_APP_HOST` | `0.0.0.0` | Interface to listen on. Use `127.0.0.1` behind a reverse proxy on the same machine. |
| `MAIL_APP_PORT` | `8787` | Port to listen on. |
| `MAIL_APP_DATA_DIR` | `server/data` | Where `accounts.json`, `scheduled.json`, `labels.json`, `lock.json` and `tracking.json` are kept. Set it to a path outside the repository on the server, e.g. `/var/lib/open-mail`. |
| `MAIL_APP_PUBLIC_URL` | taken from the request | The address recipients reach the server at, e.g. `https://apimail.advoxel.com`, for the open-tracking image. Behind a reverse proxy, also route `/t/` to the server (not only `/api/`). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Enables "Sign in with Google" (Desktop-app OAuth client, `https://mail.google.com/` scope). Only works when the browser runs on the server machine. |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | unset | Gmail account defined by the environment instead of added from the apps. |
| `ICLOUD_USER`, `ICLOUD_APP_PASSWORD` | unset | Same, for iCloud. |
| `ZOHO_USER`, `ZOHO_APP_PASSWORD`, `ZOHO_IMAP_HOST`, `ZOHO_SMTP_HOST` | unset | Same, for Zoho (hosts default to the Zoho preset). |

## Setting them up

Run `npm run setup` (or `./scripts/setup-env.sh`) and open a new terminal. The script:

- generates `MAIL_APP_TOKEN` and `MAIL_APP_SECRET_KEY`, or keeps the values you already have, so running it again is safe
- writes them to `~/.config/open-mail/env` (mode `600`, outside the repository)
- adds a line to `~/.bashrc` that exports them in every new shell
- prints the token to enter on the app's Connect screen

To see the token again later, run `echo $MAIL_APP_TOKEN`.

On the Raspberry Pi, write the file where systemd can read it, then add `EnvironmentFile=/etc/open-mail/env` to the unit:

```sh
sudo ./scripts/setup-env.sh /etc/open-mail/env
```

Optional variables go in the same file as `NAME=value` lines.

## Google Calendar (Gmail accounts)

Google doesn't let apps use your password or an app password for calendars; they need Google's own sign-in (OAuth). That takes a one-time OAuth client of your own:

1. Open [console.cloud.google.com](https://console.cloud.google.com), create a project (or pick one).
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **Google Auth Platform → Audience** (the OAuth consent screen):
   - For a Google Workspace address (e.g. `@weborama.com`), choose **Internal** if the project belongs to that organization. Then there's no test-user list and access doesn't expire.
   - Otherwise choose **External**, then add your address under **Test users**. While the app is in **Testing**, Google expires the sign-in after 7 days, so you'd reconnect weekly. To avoid that, **Publish app** (it then shows an "unverified app" warning, which is fine for your own use).
4. **Clients → Create client → Desktop app**. Copy the client ID and secret.
5. Give them to the server, which keeps them in its env file next to the other keys:

   ```sh
   GOOGLE_CLIENT_ID='….apps.googleusercontent.com' GOOGLE_CLIENT_SECRET='…' npm run setup
   ```

   Then restart the server from a new terminal.
6. In the app, open **Settings → (your Gmail account) → Calendar → Connect Google Calendar** and sign in with your Google account on Google's page. Do this with the browser on the same machine as the server: Google sends you back to `127.0.0.1` on that machine. The connection moves with `accounts.json` if you move the server later.

A Workspace admin can block third-party apps; if Google refuses the sign-in, ask them to allow this OAuth client.

## Deploying the web app (DigitalOcean Spaces)

`npm run deploy:web` (`scripts/deploy-web.sh`) builds the web app and publishes it to the Space `advoxel` under `apps/mail/` (only there: nothing else in the Space is touched or deleted), then clears the CDN cache of its HTML. It needs `s3cmd` and `doctl`, and these variables (add them to `~/.config/open-mail/env` like the others):

| Variable | What it is |
| --- | --- |
| `SPACES_KEY`, `SPACES_SECRET` | A Spaces access key: DigitalOcean → API → Spaces Keys. |
| `SPACES_REGION` | The Space's region, e.g. `fra1`, `ams3`, `nyc3` (in its URL: `advoxel.<region>.digitaloceanspaces.com`). |
| `DIGITALOCEAN_ACCESS_TOKEN` | An API token (DigitalOcean → API → Tokens, read and write), to clear the CDN cache. Without it the script tells you which files to purge by hand. |
| `SPACES_BUCKET`, `DEPLOY_PREFIX` | Optional: default `advoxel` and `apps/mail`. |
| `DO_CDN_ID` | Optional: the CDN endpoint, when it can't be found from the Space (e.g. a custom domain). |

`DRY_RUN=1 npm run deploy:web` builds and only prints what it would upload and flush. The app is opened at `mail.advoxel.com`, where nginx serves `apps/mail/index.html` for every path; so it's built for the domain root (`APP_BASE_PATH`, default empty) and loads everything (scripts, page chunks, images) from `https://cdn.advoxel.com/apps/mail` (`PUBLIC_BASE_URL`). Scripts and images have content hashes in their names and are cached for a year; the HTML and the main script (rewritten with those addresses) aren't cached and are flushed from the CDN on every deploy.

## Apps

The apps don't read environment variables, and no token is bundled into a build. Each app asks for the server address and token on its Connect screen (**Settings → Server**):

- development builds (`npm run web`, `npm run desktop`) default to `http://localhost:8787`
- production builds (`npm run desktop:build`, store builds) default to `https://apimail.advoxel.com`
