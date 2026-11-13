# SMK Gateway — Termly Report Generator

Internal staff tool for **SIEVEMK / SMK Gateway**, a UK education charity in Milton Keynes
(company 7886477, registered charity 1146451) providing tutoring to students aged 11+.

Tutors submit a **weekly** Microsoft Form per student, per subject. Staff currently retype
those responses by hand into a ~6-page "Interim Termly Report". This tool reads the
submissions, drafts every section, lets staff edit, and exports the letterhead PDF.

## Two hard rules

1. **Nothing exports without a human clicking Approve.** These are reports about children,
   read by their families. The `approved` state gates export; "Edit again" clears it.
2. **No real student data in this repository.** Everything in `sample-data/` is invented.
   Never commit a real SIEVEMK Forms export, PDF or screenshot containing a real child's
   name, comments or circumstances. The UK GDPR position on sending children's data to an
   LLM has **not** been settled with SIEVEMK — that must happen before this handles real data.

## Two codebases in here, on purpose

| Path | What it is |
|---|---|
| `src/` | Next.js app — the deployable one. Server-side key, Puppeteer PDF, API routes. |
| `artifact2/` | The current UI, built to the second design handoff, published as a claude.ai Artifact. Client-side, so it can never hold an API key. |
| `artifact/` | The first design. Superseded — kept only for reference. |
| `engine.js` | `artifact2/engine.js` is a browser port of `src/lib/*`. **Keep them in step**: same parsing, same derived ratings, same pseudonymisation. |

## Running it

```bash
npm run dev       # http://localhost:3000
npm run sample    # regenerate sample-data/smk-progress-forms-spring-2026.xlsx
npm run check     # parse the sample export and print the aggregates
npm run build
npm test          # 121 browser assertions across 8 suites against artifact2/
```

`npm test` drives a real Chromium through the whole app. It is the gate — run it before any
publish. Suites live in `tests/`; `node tests/run.mjs 03` runs one.

Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY` for Claude drafting.
Without it the app still works: generation falls back to a deterministic template.
PDF/Word ingestion does **not** have a fallback and needs the key.

## Deployment

The key belongs in **server** environment variables, never in client code. Use SIEVEMK's own
Anthropic organisation key — the commercial API is covered by Anthropic's DPA and is not
trained on, which consumer claude.ai usage does not guarantee.

PDF export runs Puppeteer, so this needs a host that runs a real process with Chromium
available: **Railway, Render or Fly.io**, via the included `Dockerfile`. Vercel's default
serverless runtime will not run it without swapping in `@sparticuz/chromium`.

The page published as a claude.ai Artifact (`artifact/`) is a **demo only**. It is
client-side, so it can never hold an API key; it borrows the viewer's own Claude through the
`sample` runtime capability. Never put a key in it.

## Data protection

`src/lib/pseudonymise.ts` is a hard boundary: **no student or tutor name reaches the model.**
Before a generation request leaves the server, names are replaced with `Student A` / `Tutor 1`
tokens (including inside free-text comments and record ids); the model's answer is rehydrated
here. `npm run check:privacy` asserts no name leaks and fails the run if one does — keep it
passing.

`findResidualRisks()` flags what the name swap cannot catch — addresses, postcodes, phone
numbers, family mentions, health and SEND language — for staff to redact before sending.

Three things to keep stating plainly rather than burying:
- Pseudonymisation is **not** anonymisation. Pseudonymised data is still personal data under
  UK GDPR; this demonstrates data minimisation, it does not remove any obligation.
- The SOCIAL, EMOTIONAL AND MENTAL HEALTH and SENSORY/PHYSICAL sections attract **Article 9
  special category** health data. Tokens do not change that.
- Free-text scrubbing is imperfect. The only reliable control is what tutors are told to
  write in the Microsoft Form.

## Pushing

Commits reach GitHub automatically: a Stop hook in `.claude/settings.local.json` runs
`scripts/auto-push.sh` after each turn, which pushes anything local that the remote does not
have. It never creates commits — an auto-generated message is worse than none, and committing
blindly would ship half-finished work — so it reports uncommitted files instead of hiding them.
It always exits 0; a failed push cannot block a turn.

`settings.local.json` is gitignored, so this is personal. A teammate cloning the repo does not
inherit auto-push.

Repo: `sosttechnologies/smk-report-generator`, **private**. It holds SMK's letterhead details
and screenshots of their internal report format — keep it private.

## Shape of the thing

**Input** — one row per student × subject × week, from a 10-question form:
student name, instructor name, subject, week beginning, weekly attendance, a
STUDENT ENGAGEMENT grid, an ACADEMICS grid, concerns, key actions, general comments.
See `.claude/skills/smk-form-schema/SKILL.md`.

App shell, tokens and state model: `.claude/skills/smk-app-design/SKILL.md`.

**Output** — one report per student per term: an overview page, an 8-column subject matrix,
then eight label/body sections. See `.claude/skills/smk-report-format/SKILL.md`.

Two ingestion paths, dispatched in `src/lib/ingest/index.ts`:

| Upload | Path | Notes |
|---|---|---|
| `.xlsx` `.csv` | `src/lib/parse.ts` | Deterministic. Fuzzy header matching, no model. |
| `.pdf` `.docx` `.txt` images | `src/lib/ingest/extract.ts` | Claude reads it into rows. Needs a key; staff must check the result. |

Both converge on `aggregateSubmissions()` in `src/lib/aggregate.ts`, then generation, then
`buildReport()` in `src/lib/report.ts`.

## Conventions

- **British English everywhere** — in the UI, the prompts and the generated reports.
- The **app chrome** is the warm SIEVEMK palette (espresso `#2A211B`, sand `#EFE4D3`,
  cream `#F2E9DC`, Cormorant Garamond + Jost). The **report document** is deliberately
  plain: black on white, Calibri (Carlito fallback), A4. Never mix the two.
- Derived ratings are heuristics over a form not designed for this report. They are always
  **editable** and labelled as derived. See `DERIVATION_NOTES` in `src/lib/aggregate.ts`.
- Default model is `claude-opus-5`. Responses use structured outputs
  (`client.messages.parse` + a Zod schema), never hand-rolled JSON parsing.
- Generation failures must **degrade, not break**: fall back to the template and tell staff
  in the toolbar why.

## Known gaps to raise with SIEVEMK

- The form captures no **Year/Key Stage**, **subject tier** or **average grade**. Staff type
  these into the setup panel per report. Adding them to the Form would remove that step.
- The term label is guessed from the dates and uses standard UK terms, but SIEVEMK's own
  sample calls 4 May – 11 June *"Spring Term"*. Staff can edit it; confirm their convention.
- `public/smk-logo.svg` is a **placeholder**. Get the real asset.
- Attendance comes from the weekly form, not a register.
