#!/usr/bin/env bash
# Creates the mail server's keys and writes them, outside the repository, to an
# env file that your shell loads automatically.
#
#   ./scripts/setup-env.sh                       # writes ~/.config/open-mail/env
#   sudo ./scripts/setup-env.sh /etc/open-mail/env   # e.g. on the Raspberry Pi, for systemd
#
# Keys that already exist are kept: running it again never changes your token or
# the key that encrypts saved account passwords. The file is KEY=value lines, so
# systemd can use it as EnvironmentFile= as is.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-${XDG_CONFIG_HOME:-$HOME/.config}/open-mail/env}"

case "$(realpath -m "$out")/" in
  "$repo"/*) echo "Refusing to write keys inside the repository: $out" >&2; exit 1 ;;
esac

# Value of KEY from an env file, or empty.
read_key() { [ -f "$2" ] && grep -E "^(export )?$1=" "$2" | tail -n1 | sed -E "s/^(export )?$1=//; s/^['\"]//; s/['\"]$//" || true; }

# 1. this env file, 2. the current environment, 3. the old .env / secret.key files.
token="$(read_key MAIL_APP_TOKEN "$out")"
token="${token:-${MAIL_APP_TOKEN:-}}"
token="${token:-$(read_key MAIL_APP_TOKEN "$repo/.env")}"

key="$(read_key MAIL_APP_SECRET_KEY "$out")"
key="${key:-${MAIL_APP_SECRET_KEY:-}}"
key="${key:-$(read_key MAIL_APP_SECRET_KEY "$repo/.env")}"
if [ -z "$key" ] && [ -f "$repo/server/data/secret.key" ]; then key="$(tr -d '[:space:]' < "$repo/server/data/secret.key")"; fi

[ -n "$token" ] || token="$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')"
[ -n "$key" ] || key="$(openssl rand -base64 32)"

# Google OAuth client (for "Connect Google Calendar"): given as variables on the command line,
#   GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… ./scripts/setup-env.sh
# they replace what the file had; otherwise the file's values stay.
google_id="${GOOGLE_CLIENT_ID:-}"
google_secret="${GOOGLE_CLIENT_SECRET:-}"
[ -n "$google_id" ] || google_id="$(read_key GOOGLE_CLIENT_ID "$out")"
[ -n "$google_secret" ] || google_secret="$(read_key GOOGLE_CLIENT_SECRET "$out")"

# Other settings already in the file are kept as they are.
others=""
if [ -f "$out" ]; then
  others="$(grep -vE '^(export )?(MAIL_APP_TOKEN|MAIL_APP_SECRET_KEY|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET)=|^# Mail server keys\.' "$out" || true)"
fi

mkdir -p "$(dirname "$out")"
umask 077
{
  echo "# Mail server keys. Keep this file private and out of the repository."
  echo "MAIL_APP_TOKEN=$token"
  echo "MAIL_APP_SECRET_KEY=$key"
  if [ -n "$google_id" ] && [ -n "$google_secret" ]; then
    echo "GOOGLE_CLIENT_ID=$google_id"
    echo "GOOGLE_CLIENT_SECRET=$google_secret"
  fi
  if [ -n "$others" ]; then printf '%s\n' "$others"; fi
} > "$out.tmp"
mv "$out.tmp" "$out"
chmod 600 "$out"

# Load the file in every new shell (skipped for system paths like /etc).
if [[ "$out" == "$HOME"/* ]]; then
  line="[ -f \"$out\" ] && { set -a; . \"$out\"; set +a; }"
  grep -qsF "$out" "$HOME/.bashrc" || printf '\n# open-mail server keys\n%s\n' "$line" >> "$HOME/.bashrc"
fi

# The keys now live in $out, so the old copies inside the repository can go.
rm -f "$repo/.env" "$repo/server/data/secret.key"

echo "Keys written to $out"
echo "Open a new terminal (or run: set -a; . \"$out\"; set +a), then: npm run server"
echo "Token for the app's Connect screen: $token"
