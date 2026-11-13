---
name: smk-app-design
description: The SMK report generator's app shell — design tokens, layout, screens, the document-editing model, state and the conventions whose reasons are not obvious from the code. Load before changing anything under artifact2/, tests/, or before adding a screen, menu, control or editing behaviour.
---

# SMK report generator — app design

Source of truth for the look: `~/Downloads/design_handoff_smk_report_generator/README.md`.
Source of truth for behaviour: **this file**, which has moved on from the handoff at the
user's direction. Where they disagree, this file wins; update it when behaviour changes.

**The app chrome and the report document are two different visual worlds.** The chrome is
this file. The document is `.claude/skills/smk-report-format/SKILL.md`: black on white,
Calibri, A4, SMK letterhead. A change to one must not leak into the other.

## The one principle behind the editing model

**The generated report is a document, not output.** Everything a person is used to in
Google Docs or Claude Docs should work the way they expect, and nothing an editor would show
should appear. Concretely:

- Click anywhere and type. Every piece of text — title, labels, headings, paragraphs,
  bullets, table cells, footer — is `contenteditable`.
- **Enter** splits the line at the caret. **Backspace** at the start of a line joins it onto
  the one above. **Delete** at the end pulls the next line up. An empty section offers a
  line to type in.
- **No per-line buttons.** The `+ Paragraph` buttons and the `×` were removed because a
  document does not have them. Do not add them back.
- **Undo and redo** (⌘Z / ⇧⌘Z, Ctrl on Windows, and two toolbar buttons) walk a snapshot
  history of the whole document — content, header, footer, section order and labels, logo
  position and size. Every mutation calls `pushUndo(r)` **before** changing anything.
- **Drag to reorder.** A grip appears at the left of subject-table rows and section rows on
  hover. Reordering sections updates the template so later reports match.
- **The logo is an object.** Click selects it (thin frame, bottom-right corner handle).
  Drag moves it anywhere across the header. The corner handle resizes, 70–480px. A paperclip
  button *below* the bottom-right corner replaces the image — placed there so it never covers
  the logo or the handle. Clicking the logo never opens a file picker.
- **"Ask for a change"** in the right panel rewrites the selected section to an
  instruction, using only the tutors' words, and clears that section's reviewed tick.

## The bug that shaped the editing code

Selecting a section used to call `renderDocument()`, which rebuilds the DOM and replaces the
node under the caret. Focus was lost before a keystroke landed, so the document *looked*
read-only. `selectSection()` now toggles classes on existing nodes. **Never re-render the
document in response to a click inside it.** Re-render only after a model change.

## Tokens — use the CSS variables, never raw hex

| Group | Variables |
|---|---|
| Surfaces | `--page #F7F6F3` · `--side #F1EFEA` · `--canvas #EFEDE8` · `--surface #FFFFFF` · `--subtle` · `--subtle-2` · `--track` |
| Interaction | `--hover #E8E5DE` · `--active #DBD6CB` (selected sidebar row — deliberately darker than hover) |
| Ink | `--ink #1B1A17` · `--body` · `--body-2` · `--muted #6B6862` · `--faint #9A968E` |
| Lines | `--border #E6E3DC` · `--divider` · `--dashed #CFCAC0` · `--off` |
| Accent | `--accent oklch(0.5 0.16 262)` · `--accent-soft` · `--accent-tint` · `--ring` |
| Status | `--pos` (reviewed) · `--priv` / `--priv-soft` (privacy, medical) |

Type: **Hanken Grotesk 600** headings (−0.02em), **Instrument Sans** UI, **JetBrains Mono**
10.5px uppercase `.mono` labels (0.08em), **Carlito** inside the document only.
Radius 6–9 controls, 10–12 cards, 14 modal and drop zone, 999 pills.

Single-theme by design: a paper-document tool committed to one light world. Every colour is
painted explicitly so the page holds on any host background.

## Where it runs — the runtime seam

The same `app.js` runs in two places and must not know which:

| Host | `sample` / `downloads` come from | PDF |
|---|---|---|
| claude.ai Artifact (demo only) | `window.claude.use(…)`, the viewer's own account | Sandbox cannot make one: a `.pdf` request degrades to an HTML page that prints itself |
| **Our backend** (the product) | `artifact2/runtime.js` over `fetch` to `/api/llm` and `/api/pdf` | Real, rendered by Chromium on the server |

`runtime.js` is the only file that knows about hosting. It asks `GET /api/llm` what the
server can do (`available`, `images`) and hands `app.js` either the host's objects or
fetch-backed equivalents with the same four calls. Keys never reach the browser.

The backend picks the model from `LLM_PROVIDER` — `anthropic`, `openrouter` (one key, any
listed model, open-weight included), `openai`, `ollama`, or `none`. With `none` every flow
still completes on the deterministic template. `npm run test:web` proves both: it starts the
app with no model, then again against a fake OpenAI-compatible server, and drives a browser
through generate → review → export each time.

Next.js serves `public/app/` (generated from `artifact2/` by `scripts/sync-app.sh`) at
`/app`. The wrapper adds `<base href="/app/">` because `/app` has no trailing slash and
relative URLs would otherwise resolve against `/`.

## Layout and screens

`#app` is a 260px sidebar plus `minmax(0,1fr)`, full height. Main is a 56px `#topbar` over a
scrolling `#screen`. Screens: `upload · generating · report · template · project`,
dispatched by `state.screen` in `render()`. The report screen takes over `#screen` with its
own grid (document canvas + `clamp(280px,28vw,360px)` panel).

### Sidebar — as the Claude web app
- **Projects** carry a folder icon (open/closed) and a chevron. Clicking the row expands or
  collapses it; **Open project** is in the ⋯ menu. A new project drops straight into inline
  rename with the name selected.
- **Report rows are the student's name alone** — no project name, no status, no count. The
  project is obvious from where the row sits.
- ⋯ menus: reports get Pin · Rename · Move to project ▸ · Mark as read/unread · Archive ·
  Delete. Projects get Open · Expand/Collapse · Pin · Rename · New report here · Archive ·
  Delete. Destructive actions confirm, then offer undo for six seconds.
- **Reports never land in a project nobody made.** `projectId` is null by default; projects
  exist only when someone creates one.

### Upload
Conventional drop zone: arrow icon, "Drag files here, or browse your computer", format
chips. Sample data is a quiet link beneath, never the main affordance. **Many students in one
upload produce many reports** — one row each with name, key stage and an include checkbox;
the button reads "Generate N reports". **Clicking a read file previews everything that came
out of it**, grouped by student, with ratings as chips and comments verbatim.

### Share & export
Page picker first (all, or any subset; rows are `<div>`, not `<label>` — see below), then
Print · Download Word · Download PDF · Email. Export is gated on every section being
reviewed. Copy describes actions, never audiences ("Opens a draft email", not "for the
family"). No vendor or model is named anywhere in the UI.

## Conventions that are easy to break

- **`render()` rebuilds everything.** Handlers attach fresh each time; never cache a node
  across renders. `renderSidebar`, `renderTop`, `renderDocument`, `renderPanel` and
  `renderMini` can be called individually.
- **`touch(r)` saves, refreshes the sidebar and the toolbar.** The toolbar shows undo/redo
  state, so it must follow every change.
- **`editable()` compares against `dataset.last`**, not the value captured at build. Any
  click blurs the focused field; comparing against a stale capture made every blur look like
  an edit, which corrupted the undo chain.
- **A checkbox inside `<label>` toggles twice** when the label forwards the click. Page
  picker rows are `<div>` with an explicit row click handler.
- **A `<span>` appended to `<tr>` is discarded by the parser.** Grips go in the first cell.
- **Long-running actions claim a synchronous lock** (`runBatch.busy`): three fast clicks
  once produced three reports.
- **Undo toasts hold the slot** for six seconds; a plain notice never steals them.
- **`localStorage` may throw** (private windows). The app must work with no persistence.
- Sample data uses unmistakable placeholder names (`Alex Sample`, `Tutor A`). A realistic
  name in sample data can be mistaken for a real child, or coincide with one.

## State

Held in `state`, persisted to `localStorage` under `smk-report-generator-v1`.

- `projects[]` — `{ id, name, pinned?, archived? }`
- `reports[]` — `{ id, projectId|null, student, keyStage, status: Draft|Ready|Shared,
  updatedAt, term, blocks, flags, reviewed, history, chat, matrix, header, footer, logo,
  pinned?, archived?, unread? }`
- `template` — logo (+`logoPos`, `logoSize`, `logoX`, `logoY`), header/footer text,
  guidance, `matrixHeaders`, `sections[]` of `{ id, label, source, instr, on, pinned? }`
- `expandedProjects` — which folders are open
- Blocks are `{ type: 'p'|'h'|'li', text }`, one array per section id

Undo history is **not** persisted: a `Map` of `{ undo: [], redo: [] }` per report id,
capped at 60 snapshots.

## Testing

`npm test` serves `artifact2/` and drives Chromium through every suite in `tests/`. The runner
parses both modules with `--input-type=module --check` first (a plain `node --check` reads
them as CommonJS and misses an unbalanced brace), and trusts each suite's exit code (a suite
that crashes part-way used to be reported as passing). Suites share `tests/helpers.mjs`.

Tests must **click and type like a person**, not set `textContent`. The lost-caret bug
survived for days because every test bypassed the caret.
