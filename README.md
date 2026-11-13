# SMK Gateway — Termly Report Generator

Internal staff tool for **SMK Gateway (SIEVEMK)**, a Milton Keynes education charity
(company 7886477, registered charity 1146451).

Tutors submit a weekly Microsoft Form per student, per subject. Staff currently retype those
responses by hand into a six-page *Interim Termly Report* for the student's family. This reads
the submissions, drafts every section, lets staff edit and review, and exports the letterhead
document.

Built by **SOST Technologies**.

## Two hard rules

1. **Nothing exports until every section has been reviewed by a person.** These are reports
   about children, read by their families.
2. **No real student data in this repository.** Everything in `sample-data/` is invented. The
   UK GDPR position — the report carries Article 9 special category health data about children
   — is unresolved, and a DPIA is required before this touches a real record.

## Getting started

```bash
npm install
npx puppeteer browsers install chrome   # PDF export and the browser tests
cp .env.example .env.local              # add ANTHROPIC_API_KEY for Claude drafting

npm run dev        # http://localhost:3000
npm test           # 121 browser assertions across 8 suites
npm run check      # parse + aggregate the sample export
npm run check:privacy
```

Without an API key the app still works end to end: drafting falls back to a deterministic
template built from the tutors' own words.

## Layout

| Path | What it is |
|---|---|
| `src/` | Next.js app — the deployable one. Server-side key, Puppeteer PDF. |
| `artifact2/` | Current UI, built to the second design handoff, published as a claude.ai Artifact. |
| `artifact/` | First design. Superseded, kept for reference. |
| `tests/` | Browser tests driven by `npm test`. |
| `docs/reference/` | The real report and form screenshots. **These are the spec.** |
| `.claude/skills/` | Form schema, report format and app design — read before changing those areas. |

`artifact2/engine.js` is a browser port of `src/lib/*`. Keep them in step.

Full context for contributors, human or agent: [`CLAUDE.md`](CLAUDE.md).
