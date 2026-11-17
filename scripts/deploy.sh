#!/usr/bin/env bash
#
# Deploy the report generator to Fly.io, London.
#
# Idempotent: creates whatever is missing, leaves the rest alone. The first run sets
# everything up, later runs just ship new code.
#
#   export DATABASE_URL='postgresql://…'     # from neon.com — free tier
#   export ALLOWED_EMAILS='you@smk.org,@sievemkgateway.org.uk'
#   export RESEND_API_KEY='re_…'             # from resend.com — free tier
#   export OPENROUTER_API_KEY='sk-or-…'      # from openrouter.ai — pennies per term
#   ./scripts/deploy.sh
#
# The database is deliberately NOT created here. Fly's Managed Postgres starts at
# $38/month; Neon's free tier covers SMK's entire usage for nothing. This script will
# not provision a database at any price — bring a connection string.
#
# The one thing it cannot do for you is log in, which opens a browser:
#   fly auth login
set -euo pipefail

APP="${FLY_APP:-smk-reports}"
REGION="${FLY_REGION:-lhr}"
ORG="${FLY_ORG:-}"
export PATH="$HOME/.fly/bin:$PATH"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v flyctl >/dev/null || die "flyctl is not installed:  curl -L https://fly.io/install.sh | sh"
flyctl auth whoami >/dev/null 2>&1 || die "Not logged in. Run:  fly auth login"

# --- what the deployment needs before it can work ----------------------------
: "${DATABASE_URL:?Set DATABASE_URL first — create a free database at https://neon.com and copy its connection string}"
: "${ALLOWED_EMAILS:?Set ALLOWED_EMAILS first, e.g. export ALLOWED_EMAILS=\"you@example.org\" — an empty list admits nobody}"

case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) die "DATABASE_URL does not look like a Postgres connection string." ;;
esac

if [ -z "${RESEND_API_KEY:-}" ]; then
  say "No RESEND_API_KEY: sign-in links will be written to \`fly logs\` instead of emailed."
  say "Fine for your own testing, useless for staff. Get a free key at https://resend.com"
fi

say "Signed in to Fly as $(flyctl auth whoami 2>/dev/null)"
if [ -z "$ORG" ]; then
  # flyctl refuses org-scoped commands without a slug when it cannot prompt.
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
  say "Creating app ${APP} in ${ORG}"
  flyctl apps create "$APP" --org "$ORG"
fi

# --- secrets -----------------------------------------------------------------
URL="${PUBLIC_URL:-https://${APP}.fly.dev}"

if flyctl secrets list --app "$APP" 2>/dev/null | grep -q AUTH_SECRET; then
  say "AUTH_SECRET already set (left alone — changing it signs everyone out)"
else
  say "Generating AUTH_SECRET"
  flyctl secrets set --app "$APP" --stage "AUTH_SECRET=$(openssl rand -base64 32)"
fi

say "Setting configuration for ${URL}"
flyctl secrets set --app "$APP" --stage \
  "DATABASE_URL=${DATABASE_URL}" \
  "AUTH_URL=${URL}" \
  "APP_URL=${URL}" \
  "ALLOWED_EMAILS=${ALLOWED_EMAILS}" \
  "EMAIL_FROM=${EMAIL_FROM:-SMK Reports <onboarding@resend.dev>}"

[ -n "${RESEND_API_KEY:-}" ]     && flyctl secrets set --app "$APP" --stage "RESEND_API_KEY=${RESEND_API_KEY}"
# With a key the model writes the prose and the rewrite box works; without one the app
# falls back to the deterministic template and the rewrite box is disabled.
if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  flyctl secrets set --app "$APP" --stage \
    "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}" \
    "LLM_PROVIDER=openrouter" \
    "LLM_MODEL=${LLM_MODEL:-meta-llama/llama-3.3-70b-instruct}"
else
  say "No OPENROUTER_API_KEY: reports come from the deterministic template and the"
  say "rewrite box will be disabled. Add one later with \`fly secrets set\`."
  flyctl secrets set --app "$APP" --stage "LLM_PROVIDER=none"
fi

# --- ship --------------------------------------------------------------------
say "Deploying (builds remotely; migrations run as the container boots)"
flyctl deploy --app "$APP" --remote-only

say "Checking health"
sleep 5
curl -fsS "${URL}/api/health" | sed 's/^/  /' || echo "  (no answer yet — try: fly logs --app $APP)"

cat <<DONE

  Live at: ${URL}

  Sign in with one of: ${ALLOWED_EMAILS}
$( [ -z "${RESEND_API_KEY:-}" ] && echo "  No RESEND_API_KEY, so the sign-in link is in:  fly logs --app ${APP}" )

  Logs:    fly logs --app ${APP}
  Health:  ${URL}/api/health
  Add someone:  fly secrets set --app ${APP} ALLOWED_EMAILS="a@x.org,b@y.org"
DONE
