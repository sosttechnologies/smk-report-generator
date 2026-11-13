#!/usr/bin/env bash
# Pushes commits that exist locally but not on the remote.
#
# Wired as a Stop hook so work reaches GitHub without anyone remembering to push.
# It deliberately does NOT create commits: an auto-generated message is worse than
# no message, and committing blindly would ship half-finished work. Claude commits
# with a real message; this guarantees the commit leaves the machine.
#
# Prints a JSON object on stdout for Claude Code to surface, and always exits 0 —
# a failed push must never block the turn.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 0

say() { printf '{"systemMessage": %s}\n' "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"; exit 0; }

git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git remote get-url origin >/dev/null 2>&1 || exit 0

branch=$(git symbolic-ref --short -q HEAD) || exit 0
git rev-parse --abbrev-ref "@{upstream}" >/dev/null 2>&1 || exit 0

ahead=$(git rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)
dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

if [ "$ahead" -eq 0 ]; then
  [ "$dirty" -gt 0 ] && say "$dirty uncommitted file(s) — not pushed. Commit them to back them up."
  exit 0
fi

if out=$(git push origin "$branch" 2>&1); then
  msg="Pushed $ahead commit(s) to origin/$branch."
  [ "$dirty" -gt 0 ] && msg="$msg $dirty file(s) still uncommitted."
  say "$msg"
else
  say "Auto-push failed: $(printf '%s' "$out" | tail -1). $ahead commit(s) still local."
fi
