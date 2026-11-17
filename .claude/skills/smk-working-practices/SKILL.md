---
name: smk-working-practices
description: How to work on the SMK Gateway report generator — spending rules, sequencing, and the specific mistakes this project has already paid for. Read before planning work, choosing infrastructure, or spending anything.
---

# Working practices for this project

Lessons this project has already paid for, kept so they are not relearned. Joshua asked
for these to live in the repo. Add to them when something goes wrong; that is the point.

## 1. Never spend his money without asking

**Name the exact resource and its price, get a yes, then create it.** Hosting, database,
domain, API plan — anything that bills.

- Approving a plan that mentions "£10–25/month" is **not** permission for a specific
  resource.
- Price it as part of *choosing* it. `--help` and the pricing page come before the create
  command, not after.
- Free tiers first: Neon (Postgres), Resend (email), OpenRouter with an open-weight model.
- If something is already billing when the mistake is spotted: **destroy it immediately**,
  then report what it cost and propose the cheap option with figures.

**What happened:** `fly mpg create --plan Basic` was assumed cheap because of the word
"Basic". It was **$38/month** — about £456/year — for what would be a few megabytes of
text. Joshua stopped the work mid-deploy: *"do not pay for anything unless you have
permission from me what are you doing?"* The cluster was destroyed within the hour.
`scripts/deploy.sh` now refuses to provision a database at any price.

He is building this for a charity. Cost is not a detail.

## 2. Foundation before features

If the tool cannot be opened by the person who needs it, a new capability is not progress.

**What happened:** a deterministic document parser, half-filled-form handling and a whole
Forms-tracking design were built into an app that had no sign-in, no shared storage and no
URL. Joshua: *"i dont feel like we are building this in the most optimal way"*, and later
*"just concentrate on the software and build the software please"*.

Before starting a feature, ask whether the thing it lands in is usable yet.

## 3. Check prerequisites before building on them

Account, CLI, credentials, quota, price — check first.

**What happened:** a 200-line Fly deploy script was written before checking whether
`flyctl` was installed or a Fly account existed. Neither was. Two seconds of checking,
discovered at the end.

## 4. Verify the thing that actually runs

A safety check pointed at unreachable code is worse than no check, because it reassures.

**What happened:** `npm run check:privacy` imports `src/lib/pseudonymise.ts`, but the app
calls `E.pseudonymise` from `artifact2/engine.js`. The guarantee repeatedly cited — "no
student name reaches the model" — was being verified against an implementation that never
runs. Still unfixed; see CLAUDE.md "Known problems".

## 5. Delete unreachable code on sight

**What happened:** roughly a third of this repository is not reachable from the running
product (`src/components/`, `artifact/`, four dead API routes, and a whole duplicate of the
report logic in `src/lib`). Because CLAUDE.md said "keep the twins in step", the weekly
parser and the half-filled-form work were each written **twice** — once where it runs, once
where nothing executes it.

Dead code is not free. It is carried on every change and it misleads.

## 6. Estimate without padding

**What happened:** "about half an hour" for a deploy that is paste-keys-and-run-one-command
plus a remote Docker build. Joshua: *"it does not have to take 30 minutes to do this, you
are more than capable"*. Quote the work, not a comfort margin.

## 7. Surface decisions before acting, not in the summary

Joshua interrupted several long unattended runs with "stop" and "what are you doing". A
turn that spends money, changes direction or provisions infrastructure should say so
before, not after.

## 8. He prefers prose over multiple choice

He declines option pickers. Recommend one thing, say why, and proceed — except where
rule 1 applies, which always needs an explicit yes.
