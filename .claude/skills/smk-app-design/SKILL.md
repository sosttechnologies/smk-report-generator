---
name: smk-app-design
description: The SMK report generator's app shell — design tokens, layout, screens, component conventions and the state model in artifact2/. Load before changing anything under artifact2/, or before adding a screen, menu or control to the app chrome.
---

# SMK report generator — app design

Source of truth: `~/Downloads/design_handoff_smk_report_generator/README.md` and its prototype.
Where this file and that disagree, **the handoff wins** — update this file to match.

**The app chrome and the report document are two different visual worlds.** Never mix them.
The chrome is this file. The document is `.claude/skills/smk-report-format/SKILL.md`: black on
white, Calibri, A4, SMK letterhead. A change to one must not leak into the other.

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
painted explicitly so the page holds on any host background. Do not add a dark palette without
redesigning the document too.

## Layout

`#app` is a 260px sidebar plus `minmax(0,1fr)`, full height. Main is a 56px `#topbar` over a
scrolling `#screen`. Screens: `upload · generating · report · template · project`, dispatched
by `state.screen` in `render()`.

The report screen is the exception: it takes over `#screen` with its own grid
(document canvas + `clamp(280px,28vw,360px)` panel) and sets `overflow:hidden`.

## Conventions that are easy to break

- **`render()` rebuilds everything.** Handlers are attached fresh each time, so never cache a
  node across renders. `renderSidebar`, `renderTop`, `renderDocument`, `renderPanel` and
  `renderMini` can be called individually when a full rebuild would lose focus or scroll.
- **`editable()` compares against `dataset.last`, not the value captured when the node was
  built.** Any click blurs the focused field; comparing against a stale capture makes every
  such blur look like an edit, which silently corrupts the undo chain. Do not "simplify" this.
- **Long-running actions claim a synchronous lock.** `runGeneration.busy` exists because three
  fast clicks landed before the first render and produced three reports.
- **Undo toasts hold the slot.** `toast(msg, undo)` reserves the toast for 6s; a plain notice
  arriving behind it is dropped rather than stealing the only route back.
- **`localStorage` may throw** (private windows). `save()`/`load()` swallow it; the app must
  stay usable with no persistence at all.
- Sidebar rows use `.side-item` + `.l1`/`.l2`; the `⋯` button is `.dots` and appears on hover.
  Menus come from `popMenu(anchor, items)` — items support `divider`, `check`, `danger` and
  nested `items` for a submenu.

## State

Held in `state`, persisted to `localStorage` under `smk-report-generator-v1`.

- `projects[]` — `{ id, name, pinned?, archived? }`
- `reports[]` — `{ id, projectId, student, keyStage, status: Draft|Ready|Shared, updatedAt,
  term, blocks, flags, reviewed, history, matrix, header, footer, logo, pinned?, archived?,
  unread?, provenance, templated }`
- `template` — logo (+`logoPos`, `logoSize`, `logoX`, `logoY`), header/footer text, guidance,
  `matrixHeaders`, and `sections[]` of `{ id, label, source, instr, on, pinned? }`
- Blocks are `{ type: 'p'|'h'|'li', text }`. One array per section id.

`overview` and `table` are pinned sections: always on, always pages 1 and 2.

## Rules the UI must keep

1. **Export unlocks only when every section is marked reviewed.** Enforced in the share modal;
   in the real build it must also be enforced server-side.
2. **Every draft states its provenance** — a model wrote it, or the offline template did.
3. **Sections carrying health or private detail show `CHECK · MEDICAL`** until reviewed.
4. **Destructive actions confirm, then offer undo** for six seconds.
