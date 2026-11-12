---
name: smk-report-format
description: The authoritative spec for the SMK Gateway Interim Termly Report document — page order, the 8-column subject matrix, the 8 label/body sections, Calibri/A4/letterhead rules. Load before touching anything under src/components/report/, src/styles/report.css, src/lib/pdfChrome.ts or the export route.
---

# SMK Gateway Interim Termly Report — document spec

Source of truth: the screenshots in `docs/reference/`. When this file and those images
disagree, **the images win** — update this file to match.

## Page order

| Page | Contents |
|---|---|
| 1 | Logo · centred `INTERIM TERMLY REPORT` and `REPORTING DATE: <range>` · bold block STUDENT / YEAR / ACADEMIC YEAR / TERM · `OVERVIEW` with prose |
| 2 | The subject matrix — one row per subject |
| 3 | `ATTENDANCE` (prose + summarised week table) and `COGNITION AND LEARNING` |
| 4 | `SUCCESSES AND ACHIEVEMENTS` and `CHALLENGES OR CONCERNS`, each grouped by subject with a bold uppercase subject heading above its bullets |
| 5 | `TARGETS OR GOALS` (flat bullets) · `COMMUNICATION AND INTERACTION` · `SOCIAL, EMOTIONAL AND MENTAL HEALTH` · `SENSORY AND/OR PHYSICAL OBSERVATIONS` |

Long sections flow onto extra physical pages. That is expected — the real document does it too.

## The subject matrix — 8 columns, in this order

1. Subject and Tier — `Maths (Higher)`; no tier means just the subject name
2. Attitude To Learning
3. Behaviour For Learning
4. Contribution In Lessons
5. Curriculum Strengths
6. Curriculum Areas For Development
7. Average score/grade on tests and mocks — `n/a` is normal and correct
8. Tutor Assessed Progress

## The label/body table

Two columns. Left: the section name, bold, uppercase, ~180px. Right: body. Both have a
1px black border. Never reorder or rename these sections — families and the charity's own
records expect these exact headings.

## Typography and page

- Body font **Calibri**, with **Carlito** as the metric-compatible fallback. Black `#111` on white.
- A4 at 96dpi = 794 × 1123px. Section labels and headings are bold.
- **Never** apply the app's brown/cream palette to the document. The warm palette is UI chrome only.

## The letterhead

Logo top-left on every page. Footer on every page:

```
● Ground Floor, 599 Avebury Boulevard, Milton Keynes MK9 3HR   ● 07908 166 261   ● info@sievemk.org.uk
      A company limited by guarantee (number 7886477) and a Registered Charity (number 1146451)
```

Address/phone/email in a spaced row, the legal line centred beneath in blue `#2b4a7d`.

**Both are drawn by Puppeteer's `displayHeaderFooter`, not by React** — see `src/lib/pdfChrome.ts`.
That is the only way they survive a section overflowing onto a second page. Consequences:

- Do **not** add an `@page { margin: ... }` rule to `report.css`. A CSS page margin overrides
  the margins the export route sets, and the content prints on top of the header.
- `PDF_MARGINS` must stay large enough for both templates, or Chrome clips them.
- On screen, `ReportPage` draws the logo and footer itself so staff see the real document;
  `printMode` omits them. Keep the two in sync.

## Editing

Every text field is an auto-growing textarea that looks like body text until focused, and
becomes read-only when the report is approved. Borders never print.
