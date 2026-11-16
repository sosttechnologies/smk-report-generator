#!/usr/bin/env bash
#
# Deploy the report generator to Fly.io, London.
#
# Run it as often as you like: it creates whatever is missing and leaves the rest alone,
# so the first run sets everything up and later runs just ship new code.
#
#   ./scripts/deploy.sh
#
# The one thing it cannot do for you is log in — that opens a browser:
#   fly auth login
set -euo pipefail

APP="${FLY_APP:-smk-reports}"
REGION="${FLY_REGION:-lhr}"
DB="${APP}-db"
# flyctl refuses org-scoped commands without a slug when it cannot prompt, which is
# every non-interactive run. Resolve it once rather than passing --org everywhere.
ORG="${FLY_ORG:-}"
export PATH="$HOME/.fly/bin:$PATH"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v flyctl >/dev/null || die "flyctl is not installed. curl -L https://fly.io/install.sh | sh"
flyctl auth whoami >/dev/null 2>&1 || die "Not logged in. Run:  fly auth login"
say "Signed in to Fly as $(flyctl auth whoami 2>/dev/null)"

if [ -z "$ORG" ]; then
  ORG="$(flyctl orgs list 2>/dev/null | awk 'NR>2 && $NF=="PERSONAL" { print $(NF-1) }' | head -1)"
  [ -n "$ORG" ] || ORG=personal
fi
say "Organisation: ${ORG}"

# --- the app -----------------------------------------------------------------
# `apps list` prints a padded, box-drawn table that is awkward to match against;
# `status` simply succeeds when the app exists and we can see it.
if flyctl status --app "$APP" >/dev/null 2>&1; then
  say "App ${APP} already exists"
else
  say "Creating app ${APP}"
  flyctl apps create "$APP" --org "$ORG"
fi

# --- the database ------------------------------------------------------------
# Managed Postgres, not the legacy `fly postgres` cluster: Fly handles backups,
# restores and upgrades. These are children's records, and the whole point of hosting
# this is that nobody has to be on hand to nurse it.
#
# Attaching sets DATABASE_URL on the app as a secret, which is what src/lib/db.ts reads.
if flyctl secrets list --app "$APP" 2>/dev/null | grep -q DATABASE_URL; then
  say "Database already attached"
else
  cluster_id() {
    flyctl mpg list --org "$ORG" 2>/dev/null | awk -v n="$DB" '$0 ~ n { print $1 }' | head -1
  }
  CLUSTER_ID="$(cluster_id)"
  if [ -z "$CLUSTER_ID" ]; then
    say "Creating Managed Postgres ${DB} in ${REGION} (plan ${PG_PLAN:-Basic})"
    flyctl mpg create --name "$DB" --region "$REGION" --org "$ORG" \
      --plan "${PG_PLAN:-Basic}" --volume-size "${PG_VOLUME_GB:-10}"
    CLUSTER_ID="$(cluster_id)"
  fi
  [ -n "$CLUSTER_ID" ] || die "Could not find the cluster id for ${DB}. Check: fly mpg list"
  say "Attaching ${DB} (${CLUSTER_ID}) to ${APP}"
  flyctl mpg attach "$CLUSTER_ID" --app "$APP"
fi

# --- secrets -----------------------------------------------------------------
URL="https://${APP}.fly.dev"

if flyctl secrets list --app "$APP" 2>/dev/null | grep -q AUTH_SECRET; then
  say "AUTH_SECRET already set (leaving it alone — changing it signs everyone out)"
else
  say "Generating AUTH_SECRET"
  flyctl secrets set --app "$APP" --stage "AUTH_SECRET=$(openssl rand -base64 32)"
fi

: "${ALLOWED_EMAILS:?Set ALLOWED_EMAILS first, e.g. export ALLOWED_EMAILS=\"you@example.com,@sievemkgateway.org.uk\"}"

say "Setting configuration"
flyctl secrets set --app "$APP" --stage \
  "AUTH_URL=${URL}" \
  "APP_URL=${URL}" \
  "ALLOWED_EMAILS=${ALLOWED_EMAILS}" \
  "EMAIL_FROM=${EMAIL_FROM:-SMK Reports <onboarding@resend.dev>}" \
  "LLM_PROVIDER=${LLM_PROVIDER:-none}"

# Optional. Without a key, sign-in links are written to `fly logs` instead of emailed —
# usable for a first look, useless for real staff.
[ -n "${RESEND_API_KEY:-}" ] && flyctl secrets set --app "$APP" --stage "RESEND_API_KEY=${RESEND_API_KEY}"
[ -n "${OPENROUTER_API_KEY:-}" ] && flyctl secrets set --app "$APP" --stage "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}"
[ -n "${LLM_MODEL:-}" ] && flyctl secrets set --app "$APP" --stage "LLM_MODEL=${LLM_MODEL}"

# --- ship --------------------------------------------------------------------
say "Deploying (builds remotely; migrations run as the container boots)"
flyctl deploy --app "$APP" --remote-only

say "Checking health"
sleep 5
curl -fsS "${URL}/api/health" | sed 's/^/  /' || echo "  (health check did not answer yet — try: fly logs --app $APP)"

cat <<DONE

  Live at: ${URL}

  Sign in with one of: ${ALLOWED_EMAILS}
$( [ -z "${RESEND_API_KEY:-}" ] && echo "  No RESEND_API_KEY set, so the sign-in link is in:  fly logs --app ${APP}" )

  Logs:    fly logs --app ${APP}
  Health:  ${URL}/api/health
DONE
