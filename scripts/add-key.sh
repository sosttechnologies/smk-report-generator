#!/usr/bin/env bash
#
# Add or replace an API key without it appearing anywhere it shouldn't.
#
#   ./scripts/add-key.sh
#
# Run this in a terminal of your own — NOT through Claude Code, and not with the `!`
# prefix, because both of those put what you type into the conversation transcript.
#
# What it does: asks for the key with the screen echo turned off, writes it to
# .env.local (which is gitignored), and offers to set it on the server. The value is
# never printed, never committed, and never written to your shell history.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env.local"
APP="${FLY_APP:-smk-reports}"
FLY="$HOME/.fly/bin/fly"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m%s\033[0m\n' "$*"; }

bold "Which key are you adding?"
echo "  1) OpenRouter   — the rewrite box and model-written prose   (sk-or-…)"
echo "  2) Resend       — sign-in emails                            (re_…)"
echo "  3) Something else"
printf 'Choose [1-3]: '
read -r choice

case "$choice" in
  1) NAME=OPENROUTER_API_KEY; PREFIX='sk-or-' ;;
  2) NAME=RESEND_API_KEY;     PREFIX='re_' ;;
  3) printf 'Variable name (e.g. SOME_API_KEY): '; read -r NAME; PREFIX='' ;;
  *) echo "Not a choice."; exit 1 ;;
esac

# -s turns off the screen echo, so the key is not shown and not left on screen.
printf 'Paste the key (it will not be shown), then press Enter: '
read -rs VALUE
echo

[ -n "$VALUE" ] || { echo "Nothing pasted."; exit 1; }
if [ -n "$PREFIX" ] && [[ "$VALUE" != "$PREFIX"* ]]; then
  warn "That does not start with '${PREFIX}', which is what a ${NAME} normally looks like."
  printf 'Use it anyway? [y/N]: '
  read -r yn
  [[ "$yn" =~ ^[Yy]$ ]] || exit 1
fi

touch "$ENV_FILE"
# Replace the line if it is already there, otherwise append. Done with a temp file so a
# half-written .env.local can never be left behind.
tmp="$(mktemp)"
grep -v "^${NAME}=" "$ENV_FILE" > "$tmp" || true
printf '%s=%s\n' "$NAME" "$VALUE" >> "$tmp"
mv "$tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "Saved to ${ENV_FILE} (gitignored, not shown, not in your shell history)."

# OpenRouter also needs the app told which provider and model to use.
EXTRA=()
if [ "$NAME" = "OPENROUTER_API_KEY" ]; then
  EXTRA=("LLM_PROVIDER=openrouter" "LLM_MODEL=${LLM_MODEL:-meta-llama/llama-3.3-70b-instruct}")
  for pair in "${EXTRA[@]}"; do
    k="${pair%%=*}"
    tmp="$(mktemp)"; grep -v "^${k}=" "$ENV_FILE" > "$tmp" || true
    printf '%s\n' "$pair" >> "$tmp"; mv "$tmp" "$ENV_FILE"
  done
  chmod 600 "$ENV_FILE"
fi

echo
printf 'Set it on the live app (%s) now? [Y/n]: ' "$APP"
read -r push
if [[ ! "$push" =~ ^[Nn]$ ]]; then
  if [ ! -x "$FLY" ]; then
    warn "flyctl not found at ${FLY} — saved locally only."
    exit 0
  fi
  bold "Setting the secret (the app restarts in a few seconds)…"
  "$FLY" secrets set --app "$APP" "${NAME}=${VALUE}" "${EXTRA[@]}" >/dev/null
  ok "Done. The app is restarting."
  echo
  echo "Check it picked it up:"
  echo "  curl -s https://${APP}.fly.dev/api/health"
fi

echo
ok "Now tell Claude: \"pasted\"."
