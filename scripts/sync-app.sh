#!/usr/bin/env bash
# Copies the UI into public/app so Next.js serves it at /app.
# Runs before every build and dev start. artifact2/ stays the single source.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf public/app && mkdir -p public/app
cp artifact2/index.html artifact2/app.js artifact2/engine.js artifact2/runtime.js artifact2/smk-logo.png public/app/
# The artifact publisher wraps the page in a skeleton; a plain web server does not.
# Wrap it here so the file is a complete document.
{
  printf '<!doctype html><html lang="en-GB"><head><meta charset="utf-8">'
  # The page is served at /app with no trailing slash, so relative URLs would
  # resolve against /. base href keeps app.js and the logo under /app/.
  printf '<base href="/app/">'
  printf '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  printf '<link rel="icon" href="/app/smk-logo.png">'
  printf '<style>:root{color-scheme:light}body{margin:0}img{max-width:100%%}[hidden]{display:none!important}</style>'
  printf '</head><body>'
  cat artifact2/index.html
  printf '</body></html>'
} > public/app/index.html
echo "synced artifact2 → public/app ($(ls public/app | wc -l | tr -d ' ') files)"
