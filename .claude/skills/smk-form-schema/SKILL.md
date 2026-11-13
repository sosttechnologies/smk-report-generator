---
name: smk-form-schema
description: The SMK STUDENT PROGRESS REPORT Microsoft Form — its 10 questions, how Forms exports them, the rating scale, the derived-rating heuristics, and the four report fields the form cannot supply. Load before touching src/lib/formSchema.ts, parse.ts, aggregate.ts, ingest/ or the generation prompts.
---

# SMK STUDENT PROGRESS REPORT — input schema

One submission = **one student × one subject × one week**. A termly report aggregates many.

## The 10 questions

| # | Question | Type | Notes |
|---|---|---|---|
| 1 | STUDENT NAME | text | Free text — spelling varies, grouped case-insensitively |
| 2 | INSTRUCTURE NAME | text | The form's own spelling. Accept "instructor" too |
| 3 | SUBJECT | text | Free text — title-cased so "maths"/"Maths" don't split |
| 4 | REPORTING WEEK ( WEEK BEGINNING) | date | `dd/MM/yyyy`, **day-first**. Snapped to the Monday |
| 5 | WEEKLY ATTENDANCE | choice | `100% WEEKLY ATTENDANCE` → full · `0% …` → none · `ABSENT ON SOME DAY/S DURING THE WEEK` → partial |
| 6 | STUDENT ENGAGEMENT | grid | Attendance · Punctuality · Preparation for Class · Homework completion |
| 7 | ACADEMICS | grid | Meets Deadlines · Quality of work · Understands key terms · Applies knowledge and understanding to new concepts · Acts on feedback |
| 8 | CONCERNS | long text | Required |
| 9 | KEY ACTIONS | long text | Optional |
| 10 | GENERAL COMMENTS | long text | Required. Includes access-arrangement observations |

Q6 columns: Excellent / Good / Average / Poor / **Not applicable**. Q7 has no "Not applicable".

## How Microsoft Forms exports it

Metadata columns first (`ID`, `Start time`, `Completion time`, `Email`, `Name`), then one column
per question. **Grids export as one column per row-item**, usually `STUDENT ENGAGEMENT [Punctuality]`,
but the spelling drifts between exports. So:

- Headers are normalised (lowercased, punctuation and brackets collapsed) before matching.
- Every field has an alias list in `SCALAR_FIELDS` / `ROW_ALIASES`.
- Grid columns are matched **before** scalars — otherwise `STUDENT ENGAGEMENT [Attendance]`
  would match the bare `attendance` alias.
- Unmatched headers are reported to staff as `unmappedHeaders`, never silently dropped.
- A bad row produces a `ParseIssue` and is skipped; it never kills the whole upload.

## Two ingestion paths

- **`.xlsx` / `.csv`** → `src/lib/parse.ts`. Deterministic, no model, works with no API key.
- **`.pdf` / `.docx` / text in SMK's own layouts** → `parseWeeklyReports()` in
  `artifact2/engine.js` (twin: `src/lib/parseWeekly.ts`). **Deterministic, no model, no key.**
  The browser gets flat text from mammoth or pdf.js and the parser finds each field by its
  label. Two layouts are recognised, and one file may hold several reports:
  - **A. "WEEKLY PROGRESS REPORT"** — the Word document. `STUDENT:` / `INSTRUCTOR:` /
    `SUBJECT:` / `WEEK COMMENCING dd/MM/yyyy`; a `PERFORMANCE & ENGAGEMENT MATRIX` of
    label→rating pairs (`Preparation for class`, `Meets deadlines`, `Applies knowledge to new
    concepts` map onto the form's row names; `Overall Engagement` is ignored); then headed
    sections. `Strengths & Achievements` + `INSTRUCTOR GENERAL COMMENTS` (+ attendance
    observations, + access arrangements) → generalComments; `Key Concerns` → concerns;
    `Agreed Action Plan` → keyActions. Headings arrive glued (`&PUNCTUALITY`,
    `REPORTREPORTING`) so every pattern tolerates missing spaces.
  - **B. "SMK STUDENT PROGRESS REPORT"** — the Microsoft Form printed to PDF. Questions
    `1.`–`10.`; the grids are rows of radio marks (● chosen, ○ not) under the column headings
    `EXCELLENT GOOD AVERAGE POOR [NOT APPLICABLE]`, so a rating is the column at the index of
    the ● mark. Attendance is the option preceded by ●. Running headers/footers
    (`SMK Student Progress Report … Page N`) are stripped first.
  Change the Word or Form template and this parser must change with it — `tests/15` builds
  both layouts on the fly and is the regression check.
- **images, or any other document layout** → the model, via `/api/llm` (server twin
  `src/lib/ingest/extract.ts`). Needs a key. Extracted rows are flagged in the preview
  ("Read by the model — check it against the original"); rows from the parser are labelled
  "no model involved".

## Rating arithmetic

`Excellent 4 · Good 3 · Average 2 · Poor 1`. `Not applicable` is excluded from means.
Band back: `≥3.5 Excellent · ≥2.5 Good · ≥1.5 Average · else Poor`.

## Derived matrix columns — heuristics, always editable

The form was never designed to feed this report, so these are approximations. They are shown
to staff with a "derived" note and can be overridden. Keep `DERIVATION_NOTES` in
`src/lib/aggregate.ts` in step with any change here.

| Column | Derived from |
|---|---|
| Attitude To Learning | mean(Preparation for Class, Homework completion, Acts on feedback) |
| Behaviour For Learning | mean(Punctuality, Attendance) |
| Contribution In Lessons | mean(Quality of work, Understands key terms) |
| Tutor Assessed Progress | trend of the academics mean: `Very good` / `Developing` / `Needs support` |

Attendance: a week counts as **full** only if every subject that week was full.

## The four fields the form cannot supply

1. **Year / Key Stage** — the report prints `YEAR: KS 4`
2. **Subject tier** — `Maths (Higher)`
3. **Average score/grade on tests and mocks** — `n/a` throughout SIEVEMK's own sample
4. **Term label** — dates derive from the week range; the label does not

Staff type these into the setup panel. Adding 1 and 2 to the Microsoft Form would remove the step.

## Prompt rules

Facts only from the submissions. British spelling. Third person. Never invent an achievement,
grade, diagnosis or family circumstance. Never speculate on medical or safeguarding matters.
Where a section has no source material, say so and ask staff to review.
