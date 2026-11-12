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

## Running it

```bash
npm run dev       # http://localhost:3000
npm run sample    # regenerate sample-data/smk-progress-forms-spring-2026.xlsx
npm run check     # parse the sample export and print the aggregates
npm run build
```

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

## Shape of the thing

**Input** — one row per student × subject × week, from a 10-question form:
student name, instructor name, subject, week beginning, weekly attendance, a
STUDENT ENGAGEMENT grid, an ACADEMICS grid, concerns, key actions, general comments.
See `.claude/skills/smk-form-schema/SKILL.md`.

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
