#!/usr/bin/env bash
# Builds the web app and publishes it to the DigitalOcean Space "advoxel" under
# apps/mail, then clears the CDN cache of its HTML. Web only: the desktop and
# phone apps aren't touched.
#
# The page itself is served by nginx at mail.advoxel.com (every path → the
# Space's apps/mail/index.html), so the app is built for the domain root and
# everything it loads (scripts, page chunks, images) comes from the CDN by its
# full address.
#
#   ./scripts/deploy-web.sh            # or: npm run deploy:web
#   DRY_RUN=1 ./scripts/deploy-web.sh  # build, then only print what would be uploaded
#
# Settings come from the environment (or ~/.config/open-mail/env, see ENVIRONMENT.md):
#   SPACES_KEY, SPACES_SECRET    Spaces access key (DigitalOcean → API → Spaces Keys);
#                                also read as SPACES_ACCESS_KEY_ID / SPACES_SECRET_ACCESS_KEY
#   SPACES_REGION                the Space's region, e.g. fra1, ams3, nyc3
#   SPACES_BUCKET                default: advoxel
#   DEPLOY_PREFIX                default: apps/mail
#   PUBLIC_BASE_URL              where the page loads its files from; default: https://cdn.advoxel.com/<prefix>
#   APP_BASE_PATH                the path the app is opened at; default: "" (the domain root, mail.advoxel.com)
#   DIGITALOCEAN_ACCESS_TOKEN    API token, for clearing the CDN cache (doctl); also read as ADVOXEL_DO_TOKEN
#   DO_CDN_ID                    optional: the CDN endpoint id (found from the Space otherwise);
#                                also read as SPACES_CDN_ENDPOINT_ID
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${OPEN_MAIL_ENV:-${XDG_CONFIG_HOME:-$HOME/.config}/open-mail/env}"
if [ -f "$env_file" ]; then set -a; . "$env_file"; set +a; fi

dry="${DRY_RUN:-}"
# The names this script uses, else the ones already exported for Advoxel (~/.bashrc).
SPACES_KEY="${SPACES_KEY:-${SPACES_ACCESS_KEY_ID:-}}"
SPACES_SECRET="${SPACES_SECRET:-${SPACES_SECRET_ACCESS_KEY:-}}"
DIGITALOCEAN_ACCESS_TOKEN="${DIGITALOCEAN_ACCESS_TOKEN:-${ADVOXEL_DO_TOKEN:-}}"
DO_CDN_ID="${DO_CDN_ID:-${SPACES_CDN_ENDPOINT_ID:-}}"
export DIGITALOCEAN_ACCESS_TOKEN # doctl reads it from the environment
bucket="${SPACES_BUCKET:-advoxel}"
prefix="${DEPLOY_PREFIX:-apps/mail}"
prefix="${prefix#/}"
prefix="${prefix%/}"
if [ -z "$dry" ]; then
  : "${SPACES_KEY:?Set SPACES_KEY (DigitalOcean → API → Spaces Keys)}"
  : "${SPACES_SECRET:?Set SPACES_SECRET}"
fi
: "${SPACES_REGION:?Set SPACES_REGION, the region of the Space (e.g. fra1)}"
endpoint="$SPACES_REGION.digitaloceanspaces.com"
command -v s3cmd >/dev/null || { echo "s3cmd is missing: pip install --user s3cmd" >&2; exit 1; }

out="$(mktemp -d)"
cfg="$(mktemp)"
trap 'rm -rf "$out" "$cfg"' EXIT
chmod 600 "$cfg"

# ------------------------------------------------------------------ build
base_path="${APP_BASE_PATH:-}"
base_path="${base_path%/}"
[ -z "$base_path" ] || base_path="/${base_path#/}"
public_base="${PUBLIC_BASE_URL:-https://cdn.advoxel.com/$prefix}"
public_base="${public_base%/}"

echo "Building the web app (opened at ${base_path:-/}, files from $public_base)…"
(cd "$repo/apps/mobile" && WEB_BASE_URL="$base_path" npx expo export --platform web --output-dir "$out" --clear >/dev/null)
[ -f "$out/index.html" ] || { echo "The build produced no index.html" >&2; exit 1; }

# Everything the app loads comes from the CDN by its full address: the page's own
# links, the per-page chunks the main script loads on demand, and the images in the
# bundle. (Relative to the page, mail.advoxel.com would answer them with the HTML.)
sed -i -e "s#=\"$base_path/_expo/#=\"$public_base/_expo/#g" -e "s#=\"$base_path/favicon.ico#=\"$public_base/favicon.ico#g" "$out/index.html"
rewritten=()
while IFS= read -r -d '' file; do
  before="$(md5sum < "$file")"
  sed -i -e "s#\"$base_path/_expo/#\"$public_base/_expo/#g" -e "s#\"$base_path/assets/#\"$public_base/assets/#g" \
    -e "s#url($base_path/assets/#url($public_base/assets/#g" "$file"
  [ "$before" = "$(md5sum < "$file")" ] || rewritten+=("${file#"$out"/}")
done < <(find "$out/_expo" -type f \( -name '*.js' -o -name '*.css' \) -print0)
grep -q "$public_base/_expo/" "$out/index.html" || { echo "Couldn't point index.html at $public_base" >&2; exit 1; }
if grep -rqE "\"$base_path/_expo/static/js/" "$out/_expo"; then echo "Some page chunks still load from the page's own site" >&2; exit 1; fi

# Opened as …/index.html: drop that part before the app starts, or the router reads it as a page.
sed -i 's#<head>#<head><script>if(location.pathname.endsWith("/index.html"))history.replaceState(null,"",location.pathname.slice(0,-10)+location.search+location.hash)</script>#' "$out/index.html"

# ----------------------------------------------------------------- upload
# Temporary s3cmd settings (deleted on exit): keys never land in a file of the repo.
cat > "$cfg" <<CONFIG
[default]
access_key = ${SPACES_KEY:-dry-run}
secret_key = ${SPACES_SECRET:-dry-run}
host_base = $endpoint
host_bucket = %(bucket)s.$endpoint
use_https = True
CONFIG

run() {
  if [ -n "$dry" ]; then printf '  would run: %s\n' "$*"; else "$@"; fi
}
s3() { run s3cmd -c "$cfg" --acl-public --no-progress "$@"; }
target="s3://$bucket/$prefix"

echo "Uploading to $target…"
# Scripts, styles and images carry a content hash in their names: cache them for a year.
# The ones rewritten above keep their names when only the CDN address changes, so they
# aren't cached (and their CDN copies are flushed below). HTML goes last, so the live
# page never points at files that aren't there yet.
excludes=(--exclude '*.html' --exclude 'metadata.json' --exclude 'sw.js')
for file in "${rewritten[@]}"; do excludes+=(--exclude "$file"); done
s3 sync --no-delete-removed --guess-mime-type --no-mime-magic "${excludes[@]}" \
  --add-header="Cache-Control: public, max-age=31536000, immutable" "$out/" "$target/"
for file in "${rewritten[@]}"; do
  type="text/javascript"; [ "${file##*.}" = css ] && type="text/css"
  s3 put --mime-type="$type" --add-header="Cache-Control: no-cache" "$out/$file" "$target/$file"
done

# The service worker keeps its name: never cached, so browsers pick up a new one.
# mail.advoxel.com must serve it at /sw.js (its nginx proxies that path here, not to index.html).
if [ -f "$out/sw.js" ]; then
  s3 put --mime-type=text/javascript --add-header="Cache-Control: no-cache" "$out/sw.js" "$target/sw.js"
fi

# HTML: never cached, so a new deploy shows up right away.
html=(--mime-type=text/html --add-header="Cache-Control: no-cache, no-store, must-revalidate")
html_keys=("$prefix/index.html" "$prefix/sw.js")
for file in "${rewritten[@]}"; do html_keys+=("$prefix/$file"); done
s3 put "${html[@]}" "$out/index.html" "$target/index.html"

# ------------------------------------------------------------ CDN cache
# The CDN may still hold the previous HTML: flush exactly those files.
if [ -z "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] && [ -z "$dry" ]; then
  echo "DIGITALOCEAN_ACCESS_TOKEN is not set: skipped clearing the CDN cache." >&2
  echo "  Flush these in the DigitalOcean panel (Spaces → $bucket → Settings → CDN → Purge cache): ${html_keys[*]}" >&2
else
  cdn="${DO_CDN_ID:-}"
  if [ -z "$cdn" ] && [ -z "$dry" ]; then
    cdn="$(doctl compute cdn list --format ID,Origin --no-header | awk -v origin="$bucket.$endpoint" '$2 == origin { print $1; exit }')"
  fi
  if [ -z "$cdn" ] && [ -z "$dry" ]; then
    echo "No CDN endpoint for $bucket.$endpoint (set DO_CDN_ID if it uses another origin): nothing to flush." >&2
  else
    files="$(IFS=,; echo "${html_keys[*]}")"
    echo "Clearing the CDN cache of the HTML (and the rewritten scripts)…"
    run doctl compute cdn flush "${cdn:-<cdn-id>}" --files "$files"
  fi
fi

echo "Done: open it at mail.advoxel.com (the page is $public_base/index.html)"
