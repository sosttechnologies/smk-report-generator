/* SMK Gateway report generator — hosted page controller. */
import * as E from './engine.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtWeek = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const ATT = { full: 'Full attendance', partial: 'Some absence', none: 'Absent' };

const state = {
  terms: [], selected: '', setups: {}, reports: {}, statuses: {},
  /** Every submission read so far, across every file. Re-aggregated on each add. */
  submissions: [],
  /** One entry per file the user has given us, kept so they can see what landed. */
  files: [],
  method: 'spreadsheet', issues: [], notes: [],
};
let sample = null, downloads = null;

/* ---------- capabilities ---------- */
(async () => {
  sample = await window.claude?.use?.('sample').catch(() => null) ?? null;
  downloads = await window.claude?.use?.('downloads').catch(() => null) ?? null;
  const badge = $('#ai-state');
  if (badge) {
    badge.textContent = sample ? 'Claude drafting available' : 'Offline drafting (template)';
    badge.dataset.on = sample ? 'yes' : 'no';
  }
  document.querySelectorAll('[data-needs-download]').forEach((n) => { n.hidden = !downloads; });
})();

/* ---------- reading uploads ---------- */
async function readSpreadsheet(file) {
  if (/\.csv$/i.test(file.name)) {
    const parsed = Papa.parse(await file.text(), { header: true, skipEmptyLines: 'greedy' });
    return E.rowsToSubmissions(parsed.data, parsed.meta.fields ?? []);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const sheet = wb.worksheets[0];
  if (!sheet) return { submissions: [], issues: [{ row: 0, field: 'file', message: 'The workbook has no sheets' }], unmappedHeaders: [] };
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i - 1] = String(c.value ?? '').trim(); });
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const rec = {};
    headers.forEach((h, i) => {
      if (!h) return;
      const v = row.getCell(i + 1).value;
      rec[h] = v instanceof Date ? v : v && typeof v === 'object' ? String(v.text ?? v.result ?? '') : v;
    });
    rows.push(rec);
  });
  return E.rowsToSubmissions(rows, headers.filter(Boolean));
}

async function documentText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.5.438/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.5.438/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      out.push(`--- page ${p} ---\n` + content.items.map((i) => i.str).join(' '));
    }
    return out.join('\n\n');
  }
  if (name.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value;
  }
  return file.text();
}

const EXTRACT_PROMPT = `You extract tutor submissions from a document for SMK Gateway, a UK education charity.

The source is the "SMK STUDENT PROGRESS REPORT" Microsoft Form. Each submission covers ONE student, ONE subject and ONE week:
1 STUDENT NAME · 2 INSTRUCTURE NAME (tutor) · 3 SUBJECT · 4 REPORTING WEEK (WEEK BEGINNING)
5 WEEKLY ATTENDANCE — "100% WEEKLY ATTENDANCE"=full, "0% WEEKLY ATTENDANCE"=none, "ABSENT ON SOME DAY/S DURING THE WEEK"=partial
6 STUDENT ENGAGEMENT grid — Attendance, Punctuality, Preparation for Class, Homework completion
7 ACADEMICS grid — Meets Deadlines, Quality of work, Understands key terms, Applies knowledge and understanding to new concepts, Acts on feedback
8 CONCERNS · 9 KEY ACTIONS · 10 GENERAL COMMENTS

Rules:
- One object per submission; a document may hold many.
- Transcribe free text EXACTLY. Never summarise, correct or improve it.
- Dates to ISO yyyy-mm-dd. A dd/MM/yyyy date is day-first (British).
- Ratings are one of Excellent, Good, Average, Poor, Not applicable, or null if absent.
- Never invent anything. A blank unfilled template means an empty submissions array.

Reply with ONLY this JSON:
{"submissions":[{"studentName":"","instructorName":"","subject":"","weekBeginning":"YYYY-MM-DD",
"weeklyAttendance":"full|none|partial",
"engagement":{"Attendance":null,"Punctuality":null,"Preparation for Class":null,"Homework completion":null},
"academics":{"Meets Deadlines":null,"Quality of work":null,"Understands key terms":null,"Applies knowledge and understanding to new concepts":null,"Acts on feedback":null},
"concerns":"","keyActions":"","generalComments":""}],"notes":[]}

DOCUMENT:
`;

async function extractFromDocument(file, onProgress) {
  if (!sample) throw new Error('Reading PDF or Word files needs Claude, which this view cannot reach. Upload the Microsoft Forms .xlsx or .csv export instead — that is read without a model.');
  onProgress('Reading the document…');
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(file.name);
  let result;
  if (isImage) {
    const limits = await sample.limits().catch(() => ({}));
    if (!limits.images) throw new Error('This view cannot send images to Claude. Upload a PDF, Word file or the Forms export instead.');
    onProgress('Claude is reading the image…');
    result = await sample.json(EXTRACT_PROMPT + '(see attached image)', { images: [file], modelTier: 'complex' });
  } else {
    const text = await documentText(file);
    if (!text.trim()) throw new Error('No readable text in that file. If it is a scanned PDF, upload it as an image instead.');
    onProgress('Claude is reading the document…');
    result = await sample.json(EXTRACT_PROMPT + text.slice(0, 120000), { modelTier: 'complex' });
  }
  const rows = Array.isArray(result?.submissions) ? result.submissions : [];
  const submissions = rows.map((r) => {
    const subject = E.canonicalSubject(r.subject);
    const clean = (obj) => Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => v && v !== 'Not applicable'));
    return {
      id: `${E.studentKey(r.studentName)}|${subject}|${r.weekBeginning}`,
      studentName: String(r.studentName ?? '').trim().replace(/\s+/g, ' '),
      instructorName: String(r.instructorName ?? '').trim(),
      subject,
      weekBeginning: E.parseWeekBeginning(r.weekBeginning) ?? r.weekBeginning,
      weeklyAttendance: ['full', 'none', 'partial'].includes(r.weeklyAttendance) ? r.weeklyAttendance : 'partial',
      engagement: clean(r.engagement), academics: clean(r.academics),
      concerns: String(r.concerns ?? ''), keyActions: String(r.keyActions ?? ''),
      generalComments: String(r.generalComments ?? ''),
    };
  }).filter((s) => s.studentName && s.subject && s.weekBeginning);
  return { submissions, issues: [], unmappedHeaders: [], notes: Array.isArray(result?.notes) ? result.notes : [] };
}

/* ---------- upload flow ---------- */

/** Reads one file. Never throws — a bad file must not take the batch down with it. */
async function readOne(file, progress) {
  const spreadsheet = /\.(xlsx|xlsm|csv)$/i.test(file.name);
  try {
    const res = spreadsheet ? await readSpreadsheet(file) : await extractFromDocument(file, progress);
    return {
      name: file.name,
      kind: spreadsheet ? 'spreadsheet' : 'document',
      ok: res.submissions.length > 0,
      count: res.submissions.length,
      submissions: res.submissions,
      issues: res.issues ?? [],
      notes: res.notes ?? [],
      error: res.submissions.length ? null
        : (spreadsheet ? 'No usable submissions — is this the Forms response export?'
                       : 'No submissions found. A blank form template has nothing to read.'),
    };
  } catch (e) {
    return { name: file.name, kind: spreadsheet ? 'spreadsheet' : 'document', ok: false,
      count: 0, submissions: [], issues: [], notes: [], error: e?.message || 'Could not read this file.' };
  }
}

/** Later submissions win: a tutor who resubmits a week should replace the first answer. */
function mergeSubmissions(existing, incoming) {
  const byId = new Map(existing.map((s) => [s.id, s]));
  let replaced = 0;
  for (const s of incoming) {
    if (byId.has(s.id)) replaced++;
    byId.set(s.id, s);
  }
  return { merged: [...byId.values()], replaced };
}

async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  const status = $('#up-status');
  const err = $('#up-error');
  const log = $('#up-log');
  err.hidden = true;
  status.hidden = false;
  log.hidden = false;
  log.innerHTML = '';

  const results = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const prefix = files.length > 1 ? `File ${i + 1} of ${files.length} · ` : '';
    status.textContent = `${prefix}Reading ${f.name}…`;
    const line = el('div', 'logline');
    line.innerHTML = `<span class="spin">●</span> ${esc(f.name)}`;
    log.append(line);

    const res = await readOne(f, (m) => { status.textContent = prefix + m; });
    results.push(res);
    line.className = 'logline ' + (res.ok ? 'ok' : 'bad');
    line.innerHTML = res.ok
      ? `<span class="mark">✓</span> ${esc(res.name)} <span class="dim">${res.count} submission${res.count === 1 ? '' : 's'}</span>`
      : `<span class="mark">✕</span> ${esc(res.name)} <span class="dim">${esc(res.error)}</span>`;
  }

  status.hidden = true;
  const good = results.filter((r) => r.ok);

  if (!good.length) {
    err.textContent = files.length === 1
      ? (results[0].error || 'Could not read that file.')
      : 'None of those files contained readable tutor submissions.';
    err.hidden = false;
    return;
  }

  const { merged, replaced } = mergeSubmissions(state.submissions, good.flatMap((r) => r.submissions));
  state.submissions = merged;
  state.files = [...state.files, ...results];
  state.issues = [...state.issues, ...good.flatMap((r) => r.issues)];
  state.notes = [...state.notes, ...good.flatMap((r) => r.notes)];
  state.method = state.files.some((f) => f.ok && f.kind === 'document') ? 'document' : 'spreadsheet';
  state.terms = E.aggregateSubmissions(state.submissions);

  // Keep the current student selected when more files are added to an open session.
  if (!state.terms.some((t) => t.id === state.selected)) state.selected = state.terms[0].id;
  for (const t of state.terms) if (!state.setups[t.id]) state.setups[t.id] = E.defaultSetup(t);

  $('#upload').hidden = true;
  $('#workspace').hidden = false;
  render();

  const failed = results.filter((r) => !r.ok).length;
  const bits = [`${good.length} file${good.length === 1 ? '' : 's'} read`];
  if (replaced) bits.push(`${replaced} submission${replaced === 1 ? '' : 's'} updated`);
  if (failed) bits.push(`${failed} could not be read`);
  if (files.length > 1 || failed || replaced) toast(bits.join(' · '));
}

/* ---------- rendering ---------- */
const PILL = {
  none: ['Forms in', 'chip'], generating: ['Drafting…', 'chip'],
  draft: ['Needs review', 'chip review'], approved: ['Approved', 'chip dark'], exported: ['Exported', 'chip dark'],
};

function render() {
  const term = state.terms.find((t) => t.id === state.selected);
  if (!term) return;
  const status = state.statuses[state.selected] ?? 'none';
  const report = state.reports[state.selected];
  const setup = state.setups[state.selected];
  const locked = status === 'approved' || status === 'exported';

  const ok = state.files.filter((f) => f.ok);
  $('#file-label').textContent =
    `${ok.length} file${ok.length === 1 ? '' : 's'} · ${state.submissions.length} submissions · ${state.terms.length} students`;
  $('#file-label').title = ok.map((f) => `${f.name} (${f.count})`).join('\n');

  // students
  const list = $('#students'); list.innerHTML = '';
  const done = state.terms.filter((t) => ['approved', 'exported'].includes(state.statuses[t.id] ?? 'none')).length;
  $('#progress').textContent = `${done} of ${state.terms.length} reports approved`;
  for (const t of state.terms) {
    const [label, cls] = PILL[state.statuses[t.id] ?? 'none'];
    const b = el('button', 'srow' + (t.id === state.selected ? ' on' : ''));
    b.innerHTML = `<span class="srow-top"><span>${esc(t.studentName)}</span><span class="dim">${t.subjects.length} subj</span></span><span class="${cls}">${label}</span>`;
    b.onclick = () => { state.selected = t.id; render(); };
    list.append(b);
  }

  // submissions
  $('#who').textContent = term.studentName;
  $('#who-sub').textContent = `${term.submissions.length} submissions · ${term.subjects.length} subjects · ${term.attendance.distinctWeeks} weeks`;
  $('#extract-warn').hidden = state.method !== 'document';
  const cards = $('#cards'); cards.innerHTML = '';
  for (const s of term.subjects) {
    const c = el('div', 'card');
    c.innerHTML = `<div class="card-top"><span>${esc(s.subject)}</span><span class="dim">${s.weekCount} weeks · ${esc(s.instructors.join(', ') || 'no tutor')}</span></div>
      <dl><dt title="${esc(E.DERIVATION_NOTES.attitudeToLearning)}">Attitude</dt><dd>${s.attitudeToLearning}</dd>
      <dt title="${esc(E.DERIVATION_NOTES.behaviourForLearning)}">Behaviour</dt><dd>${s.behaviourForLearning}</dd>
      <dt title="${esc(E.DERIVATION_NOTES.contributionInLessons)}">Contribution</dt><dd>${s.contributionInLessons}</dd>
      <dt title="${esc(E.DERIVATION_NOTES.tutorAssessedProgress)}">Progress</dt><dd>${s.tutorAssessedProgress}</dd></dl>
      <details><summary>Weekly comments</summary><div class="weekly">
        ${s.generalComments.map((t) => `<p><span class="dim">Comment — </span>${esc(t)}</p>`).join('')}
        ${s.concerns.map((t) => `<p><span class="dim">Concern — </span>${esc(t)}</p>`).join('')}
      </div></details>`;
    cards.append(c);
  }

  renderSetup(term, setup, locked || status === 'generating');

  const gen = $('#generate');
  gen.textContent = status === 'generating' ? 'Drafting report…' : report ? 'Redraft whole report' : 'Generate termly report';
  gen.disabled = status === 'generating' || locked;

  // toolbar
  $('#doc-status').textContent = {
    none: 'No draft', generating: 'Drafting from tutor submissions…',
    draft: 'Draft · edit any section, then approve',
    approved: 'Approved · ready to export', exported: 'Exported',
  }[status];
  $('#approve').hidden = status !== 'draft';
  $('#reopen').hidden = !locked;
  // Visible from the moment a draft exists, so the route out is discoverable —
  // but disabled until a person approves. Hiding them read as broken, not locked.
  const exportable = !!report;
  const why = locked ? '' : 'Approve the report first';
  for (const id of ['#print', '#save']) {
    const b = $(id);
    b.hidden = !exportable;
    b.disabled = !locked;
    b.title = why;
  }
  $('#save').hidden = !exportable || !downloads;

  const note = $('#note');
  if (report?.provenance) {
    note.textContent = report.provenance;
    note.dataset.kind = report.templateGenerated ? 'template' : 'claude';
    note.hidden = false;
  } else {
    note.hidden = true;
  }

  $('#empty').hidden = !!report;
  $('#edit-hint').hidden = !report || locked;
  $('#empty-hint').textContent = `Check ${term.studentName.split(' ')[0]}'s submissions on the left, fill in the report details, then generate a draft. Nothing is exported until a member of staff approves it.`;
  $('#paper').hidden = !report;
  if (report) renderReport(report, locked);
}

function renderSetup(term, setup, disabled) {
  const box = $('#setup-fields'); box.innerHTML = '';
  const row = (label, key) => {
    const w = el('label', 'f');
    w.innerHTML = `<span>${label}</span>`;
    const i = el('input'); i.value = setup[key] ?? ''; i.disabled = disabled;
    i.placeholder = key === 'year' ? 'KS 4' : '';
    i.oninput = () => { setup[key] = i.value; const r = state.reports[state.selected]; if (r) { r.setup = { ...setup }; renderReport(r, false); } };
    w.append(i); return w;
  };
  box.append(row('Year / Key stage', 'year'), row('Academic year', 'academicYear'),
    row('Term', 'termLabel'), row('Reporting date', 'reportingDateLabel'));

  const subs = el('div', 'subs');
  subs.append(el('span', 'f-head', 'Tier and average grade per subject'));
  for (const s of term.subjects) {
    const line = el('div', 'subline');
    line.append(el('span', null, s.subject));
    const tier = el('input'); tier.placeholder = 'Tier'; tier.value = setup.tiers[s.subject] ?? ''; tier.disabled = disabled;
    tier.oninput = () => { setup.tiers[s.subject] = tier.value; const r = state.reports[state.selected]; if (r) { r.matrix = E.buildMatrix(term, setup, r.content); renderReport(r, false); } };
    const grade = el('input'); grade.placeholder = 'n/a'; grade.value = setup.averageGrades[s.subject] ?? ''; grade.disabled = disabled;
    grade.oninput = () => { setup.averageGrades[s.subject] = grade.value; const r = state.reports[state.selected]; if (r) { r.matrix = E.buildMatrix(term, setup, r.content); renderReport(r, false); } };
    line.append(tier, grade); subs.append(line);
  }
  box.append(subs);
}

/** A single-line inline editor for a label or heading. */
function line(value, readOnly, onInput, aria, cls) {
  const n = el('span', 'rl' + (cls ? ' ' + cls : ''));
  n.textContent = value ?? '';
  n.setAttribute('aria-label', aria);
  if (!readOnly) {
    n.contentEditable = 'plaintext-only';
    n.spellcheck = false;
    n.addEventListener('input', () => onInput(n.textContent));
  }
  return n;
}

function field(value, readOnly, onInput, aria) {
  const t = el('textarea', 'rf'); t.value = value ?? ''; t.readOnly = readOnly; t.rows = 1;
  t.setAttribute('aria-label', aria);
  const grow = () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
  t.addEventListener('input', () => { grow(); onInput(t.value); });
  requestAnimationFrame(grow);
  return t;
}

function listField(items, readOnly, onInput, aria) {
  if (readOnly) {
    const ul = el('ul');
    (items ?? []).filter(Boolean).forEach((i) => ul.append(el('li', null, i)));
    return ul;
  }
  return field((items ?? []).join('\n'), false, (v) => onInput(v.split('\n')), aria);
}

function renderReport(report, locked) {
  const { setup, content, matrix, attendance } = report;
  const L = report.labels;
  const subjects = matrix.map((m) => m.subject);
  const root = $('#paper'); root.innerHTML = '';
  const relabel = () => { /* labels mutate in place; nothing else to recompute */ };

  const page = () => {
    const p = el('section', 'sheet');
    const logoWrap = el('div', 'rlogo-wrap');
    const img = el('img', 'rlogo');
    img.src = report.logo || 'smk-logo.svg';
    img.alt = 'SMK Gateway';
    logoWrap.append(img);
    if (!locked) {
      const swap = el('button', 'logo-swap', 'Replace logo');
      swap.type = 'button';
      swap.onclick = () => $('#logo-input').click();
      logoWrap.append(swap);
    }
    p.append(logoWrap);
    root.append(p);
    return p;
  };

  const foot = (p) => {
    const f = el('div', 'rfoot');
    const row = el('div', 'rfoot-row');
    const item = (key, aria) => {
      const sp = el('span');
      sp.innerHTML = '<i>&#9679;</i> ';
      sp.append(line(L[key], locked, (v) => { L[key] = v; }, aria, 'tiny'));
      return sp;
    };
    row.append(item('footerAddress', 'Footer address'), item('footerPhone', 'Footer phone'), item('footerEmail', 'Footer email'));
    f.append(row);
    const legal = el('div', 'rlegal');
    legal.append(line(L.footerLegal, locked, (v) => { L.footerLegal = v; }, 'Footer legal line', 'tiny'));
    f.append(legal);
    p.append(f);
  };

  /* ---- page 1 ---- */
  const p1 = page();
  const title = el('div', 'rtitle');
  const t1 = el('div'); t1.append(line(L.title1, locked, (v) => { L.title1 = v; }, 'Report title'));
  const t2 = el('div');
  t2.append(line(L.title2, locked, (v) => { L.title2 = v; }, 'Reporting date label'));
  t2.append(document.createTextNode(' '));
  t2.append(line(setup.reportingDateLabel, locked, (v) => { setup.reportingDateLabel = v; }, 'Reporting date'));
  title.append(t1, t2);
  p1.append(title);

  const meta = el('div', 'rmeta');
  const metaRow = (labelKey, value, onValue, aria) => {
    const d = el('div');
    d.append(line(L[labelKey], locked, (v) => { L[labelKey] = v; }, aria + ' label'));
    d.append(document.createTextNode(': '));
    d.append(line(value, locked, onValue, aria));
    return d;
  };
  meta.append(
    metaRow('student', report.studentName.toUpperCase(), (v) => { report.studentName = v; }, 'Student'),
    metaRow('year', setup.year || '—', (v) => { setup.year = v; }, 'Year'),
    metaRow('academicYear', setup.academicYear, (v) => { setup.academicYear = v; }, 'Academic year'),
    metaRow('term', setup.termLabel, (v) => { setup.termLabel = v; }, 'Term'),
  );
  p1.append(meta);

  const ovLabel = el('div', 'rlabel');
  ovLabel.append(line(L.overview, locked, (v) => { L.overview = v; }, 'Overview heading'));
  p1.append(ovLabel);
  p1.append(field(content.overview, locked, (v) => { content.overview = v; }, 'Overview'));
  foot(p1);

  /* ---- page 2: the matrix ---- */
  const p2 = page();
  const table = el('table', 'matrix');
  const thead = el('thead'); const htr = el('tr');
  L.matrix.forEach((h, i) => {
    const th = el('th');
    th.append(line(h, locked, (v) => { L.matrix[i] = v; }, `Column heading ${i + 1}`));
    htr.append(th);
  });
  thead.append(htr); table.append(thead);

  const tb = el('tbody');
  matrix.forEach((r) => {
    const tr = el('tr');
    const first = el('td');
    first.append(line(E.subjectWithTier(r.subject, r.tier), locked, (v) => { r.subject = v; r.tier = ''; }, `Subject, ${r.subject}`));
    tr.append(first);
    const cell = (key, aria) => { const td = el('td'); td.append(field(r[key], locked, (v) => { r[key] = v; }, aria)); return td; };
    tr.append(cell('attitudeToLearning', `Attitude, ${r.subject}`), cell('behaviourForLearning', `Behaviour, ${r.subject}`),
      cell('contributionInLessons', `Contribution, ${r.subject}`), cell('curriculumStrengths', `Strengths, ${r.subject}`),
      cell('curriculumAreasForDevelopment', `Areas for development, ${r.subject}`), cell('averageGrade', `Average grade, ${r.subject}`),
      cell('tutorAssessedProgress', `Progress, ${r.subject}`));
    tb.append(tr);
  });
  table.append(tb); p2.append(table); foot(p2);

  /* ---- page 3: attendance + cognition ---- */
  const p3 = page();
  const d3 = el('table', 'detail'); const b3 = el('tbody');

  const attTd = el('td');
  attTd.append(field(content.attendanceNarrative, locked, (v) => { content.attendanceNarrative = v; }, 'Attendance narrative'));
  const att = el('table', 'att');
  const ahead = el('thead'); const ahr = el('tr');
  L.attendanceCols.forEach((h, i) => {
    const th = el('th');
    th.append(line(h, locked, (v) => { L.attendanceCols[i] = v; }, `Attendance column ${i + 1}`));
    ahr.append(th);
  });
  ahead.append(ahr); att.append(ahead);
  const ab = el('tbody');
  attendance.summary.forEach((w, i) => {
    const tr = el('tr');
    const cells = [fmtWeek(w.weekBeginning), w.subjects.join(', '), ATT[w.attendance], w.punctuality ?? '—'];
    cells.forEach((text, c) => {
      const td = el('td');
      td.append(line(text, locked, () => { /* display-only override; figures come from the forms */ }, `Attendance row ${i + 1} cell ${c + 1}`));
      td.firstChild.contentEditable = locked ? 'false' : 'plaintext-only';
      tr.append(td);
    });
    ab.append(tr);
  });
  const totalTr = el('tr');
  const tdA = el('td'); tdA.colSpan = 2; tdA.innerHTML = '<strong>Total</strong>';
  const tdB = el('td'); tdB.colSpan = 2;
  tdB.innerHTML = `<strong>${attendance.fullWeeks} of ${attendance.distinctWeeks} weeks in full</strong>`;
  totalTr.append(tdA, tdB); ab.append(totalTr);
  att.append(ab); attTd.append(att);

  const r3a = el('tr'); r3a.append(labCell(L, 'attendance', locked, 'Attendance heading'), attTd); b3.append(r3a);

  const cogTd = el('td');
  cogTd.append(field(content.cognitionAndLearning, locked, (v) => { content.cognitionAndLearning = v; }, 'Cognition and learning'));
  const r3b = el('tr'); r3b.append(labCell(L, 'cognition', locked, 'Cognition heading'), cogTd); b3.append(r3b);
  d3.append(b3); p3.append(d3); foot(p3);

  /* ---- page 4: successes + challenges ---- */
  const p4 = page();
  const d4 = el('table', 'detail'); const b4 = el('tbody');
  const group = (src, key) => {
    const td = el('td');
    subjects.forEach((sub) => {
      const h = el('div', 'subhead');
      h.append(line(sub.toUpperCase(), locked, () => {}, `${key} subject heading`));
      td.append(h);
      td.append(listField(src[sub], locked, (items) => { src[sub] = items; }, `${key} for ${sub}`));
    });
    return td;
  };
  const r4a = el('tr'); r4a.append(labCell(L, 'successes', locked, 'Successes heading'), group(content.successes, 'successes')); b4.append(r4a);
  const r4b = el('tr'); r4b.append(labCell(L, 'challenges', locked, 'Challenges heading'), group(content.challenges, 'challenges')); b4.append(r4b);
  d4.append(b4); p4.append(d4); foot(p4);

  /* ---- page 5: targets + observations ---- */
  const p5 = page();
  const d5 = el('table', 'detail'); const b5 = el('tbody');
  const tTd = el('td'); tTd.append(listField(content.targets, locked, (v) => { content.targets = v; }, 'Targets or goals'));
  const r5a = el('tr'); r5a.append(labCell(L, 'targets', locked, 'Targets heading'), tTd); b5.append(r5a);
  const simple = (labelKey, key, aria) => {
    const td = el('td'); td.append(field(content[key], locked, (v) => { content[key] = v; }, aria));
    const tr = el('tr'); tr.append(labCell(L, labelKey, locked, aria + ' heading'), td); b5.append(tr);
  };
  simple('communication', 'communicationAndInteraction', 'Communication and interaction');
  simple('semh', 'socialEmotionalMentalHealth', 'Social, emotional and mental health');
  simple('sensory', 'sensoryPhysical', 'Sensory and physical observations');
  d5.append(b5); p5.append(d5); foot(p5);

  relabel();
}

function labCell(L, key, locked, aria) {
  const td = el('td', 'lab');
  td.append(line(L[key], locked, (v) => { L[key] = v; }, aria));
  return td;
}

/* ---------- generation ---------- */
function promptFor(term) {
  const L = [];
  L.push(`STUDENT: ${term.studentName}`);
  L.push(`REPORTING PERIOD: week beginning ${term.firstWeek} to week beginning ${term.lastWeek}`);
  L.push('');
  L.push('ATTENDANCE (computed from the weekly forms — do not contradict these figures):');
  L.push(`- ${term.attendance.fullWeeks} of ${term.attendance.distinctWeeks} weeks attended in full; ${term.attendance.partialWeeks} week(s) with some absence; ${term.attendance.absentWeeks} week(s) missed entirely.`);
  L.push(`- Most common punctuality rating: ${term.attendance.modalPunctuality ?? 'not recorded'}`);
  L.push('');
  for (const s of term.subjects) {
    L.push(`SUBJECT: ${s.subject} (tutors: ${s.instructors.join(', ') || 'not recorded'}, ${s.weekCount} weeks)`);
    L.push(`  Derived — attitude: ${s.attitudeToLearning}; behaviour: ${s.behaviourForLearning}; contribution: ${s.contributionInLessons}; progress: ${s.tutorAssessedProgress}`);
    L.push('  Weekly general comments:'); s.generalComments.forEach((c) => L.push('   - ' + c));
    L.push('  Weekly concerns:'); s.concerns.forEach((c) => L.push('   - ' + c));
    L.push('  Weekly key actions:'); s.keyActions.forEach((c) => L.push('   - ' + c));
    L.push('');
  }
  const keys = term.subjects.map((s) => s.subject);
  return `You write termly progress reports for SMK Gateway (SIEVEMK Gateway), a UK education charity in Milton Keynes tutoring students aged 11 and over.

Voice: warm, professional, specific. Third person. British spelling throughout.

Absolute rules:
- Use ONLY facts in the submissions below. Never invent an achievement, grade, diagnosis, family circumstance or concern.
- Where there is no information for a section, say so plainly and ask staff to review. Do not pad.
- Never speculate about medical, psychological or safeguarding matters. Report fatigue or medication only as the tutor described it.
- These are reports about children, read by their families. Be constructive about difficulties; never dismissive or alarming.

${L.join('\n')}
Reply with ONLY this JSON:
{"overview":"2-3 sentences naming the subjects studied",
"subjects":{${keys.map((k) => `"${k}":{"curriculumStrengths":"short table-cell phrase","areasForDevelopment":"short table-cell phrase"}`).join(',')}},
"attendanceNarrative":"2-3 sentences consistent with the figures above",
"cognitionAndLearning":"4-6 paragraphs separated by \\n\\n",
"successes":{${keys.map((k) => `"${k}":["4-6 short bullets"]`).join(',')}},
"challenges":{${keys.map((k) => `"${k}":["3-8 short bullets, constructive"]`).join(',')}},
"targets":["6-12 short actionable targets from the key actions"],
"communicationAndInteraction":"2-3 sentences from the comments only",
"socialEmotionalMentalHealth":"1-3 sentences; if nothing recorded, say none identified",
"sensoryPhysical":"1-3 sentences; only what tutors reported, else none identified"}`;
}

function coerce(raw, term, fallback) {
  if (!raw || typeof raw !== 'object') return fallback;
  const str = (v, f) => (typeof v === 'string' && v.trim() ? v.trim() : f);
  const arr = (v, f) => (Array.isArray(v) && v.length ? v.map(String).filter(Boolean) : f);
  const subjects = {}, successes = {}, challenges = {};
  for (const s of term.subjects) {
    const k = s.subject;
    subjects[k] = {
      curriculumStrengths: str(raw.subjects?.[k]?.curriculumStrengths, fallback.subjects[k].curriculumStrengths),
      areasForDevelopment: str(raw.subjects?.[k]?.areasForDevelopment, fallback.subjects[k].areasForDevelopment),
    };
    successes[k] = arr(raw.successes?.[k], fallback.successes[k] ?? []);
    challenges[k] = arr(raw.challenges?.[k], fallback.challenges[k] ?? []);
  }
  return {
    overview: str(raw.overview, fallback.overview), subjects,
    attendanceNarrative: str(raw.attendanceNarrative, fallback.attendanceNarrative),
    cognitionAndLearning: str(raw.cognitionAndLearning, fallback.cognitionAndLearning),
    successes, challenges,
    targets: arr(raw.targets, fallback.targets),
    communicationAndInteraction: str(raw.communicationAndInteraction, fallback.communicationAndInteraction),
    socialEmotionalMentalHealth: str(raw.socialEmotionalMentalHealth, fallback.socialEmotionalMentalHealth),
    sensoryPhysical: str(raw.sensoryPhysical, fallback.sensoryPhysical),
  };
}

async function generate() {
  const term = state.terms.find((t) => t.id === state.selected);
  const setup = state.setups[state.selected];
  state.statuses[state.selected] = 'generating';
  render();

  const fallback = E.generateFromTemplate(term);
  let content = fallback, templated = true, note = '';

  if (sample) {
    try {
      // Names never reach the model: it writes about "Student A", and the real
      // names are put back here. See pseudonymise() in engine.js.
      const { term: masked, pseudonym } = E.pseudonymise(term);
      const raw = await sample.json(promptFor(masked), { modelTier: 'complex' });
      content = coerce(E.rehydrate(raw, pseudonym), term, fallback);
      templated = false;
    } catch (e) {
      note = (e?.code === 'not_granted' ? 'Claude access was declined' : e?.message || 'Claude could not draft this') + ' — drafted from the offline template instead.';
    }
  } else {
    note = 'Claude is not available in this view — drafted from the offline template.';
  }

  const existing = state.reports[state.selected];
  state.reports[state.selected] = {
    studentId: term.id, studentName: term.studentName, setup,
    labels: existing?.labels ?? E.defaultLabels(),
    logo: existing?.logo ?? state.logo ?? null,
    risks: E.findResidualRisks(term),
    matrix: E.buildMatrix(term, setup, content), content,
    attendance: term.attendance, templateGenerated: templated,
    provenance: templated
      ? (note || 'Assembled offline from the tutors\u2019 own words \u2014 no model was used.')
      : 'Drafted by Claude from the tutor submissions. Names were replaced with \u201cStudent A\u201d before sending and restored here. Check every section before approving.',
  };
  state.statuses[state.selected] = 'draft';
  render();
}

/* ---------- export ---------- */
function reportHtml(report) {
  const clone = $('#paper').cloneNode(true);
  clone.querySelectorAll('.logo-swap').forEach((b) => b.remove());
  clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
  clone.querySelectorAll('textarea').forEach((t) => {
    const d = document.createElement('div'); d.className = 'rf-static';
    t.value.split('\n').forEach((line, i) => { if (i) d.append(document.createElement('br')); d.append(document.createTextNode(line)); });
    t.replaceWith(d);
  });
  const css = $('#report-css').textContent;
  const prov = report.provenance ? `<p class="prov">${esc(report.provenance)}</p>` : '';
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<title>${esc(report.studentName)} — ${esc(report.setup.termLabel)}</title>
<link href="https://fonts.googleapis.com/css2?family=Carlito:wght@400;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#fff}${css}
.sheet{box-shadow:none;margin:0 auto;page-break-after:always}
.sheet:last-child{page-break-after:auto}
.prov{max-width:794px;margin:0 auto;padding:14px 48px 40px;font:11px/1.5 Carlito,Calibri,sans-serif;color:#555}
@media print{.prov{display:none}}
@page{size:A4;margin:0}</style></head><body><div id="paper">${clone.innerHTML}</div>${prov}
<script>
/* Opens the print dialog once fonts have settled, so the saved file is one step
   from a PDF. Guarded: a viewer who just wants to read it can cancel. */
window.addEventListener('load', function () {
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { setTimeout(function () { window.print(); }, 300); });
  } else { setTimeout(function () { window.print(); }, 600); }
});
<\/script></body></html>`;
}

async function saveHtml() {
  const report = state.reports[state.selected];
  if (!report || !downloads) return;
  try {
    await downloads.save({
      filename: `${report.studentName} — ${report.setup.termLabel.split(' (')[0]}.html`,
      data: reportHtml(report),
    });
    state.statuses[state.selected] = 'exported';
    render();
    toast('Saved. Open the file — it opens the print dialog, then choose Save as PDF.');
  } catch (e) {
    if (e?.code !== 'cancelled') toast(e?.message || 'Could not save the file.');
  }
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 4000);
}

/* ---------- wiring ---------- */
const input = $('#file-input');
$('#choose').onclick = () => input.click();
input.onchange = () => { if (input.files?.length) handleFiles(input.files); input.value = ''; };
const drop = $('#dropzone');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over');
  if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files); });

$('#generate').onclick = generate;
$('#approve').onclick = () => {
  state.statuses[state.selected] = 'approved';
  render();
  toast(`${state.terms.find((t) => t.id === state.selected).studentName.split(' ')[0]}'s report approved`);
};
$('#reopen').onclick = () => { state.statuses[state.selected] = 'draft'; render(); };
$('#print').onclick = () => {
  // No way to detect a blocked print: window.print() returns nothing either way.
  // So attempt it, and say what to do if the dialog never appears.
  try { window.print(); } catch { /* sandboxed */ }
  setTimeout(() => {
    toast(downloads
      ? 'No print dialog? This page is sandboxed — use Download instead; the file opens ready to print.'
      : 'No print dialog? This page is sandboxed. Open the report in the full app to export a PDF.');
  }, 1200);
};
$('#save').onclick = saveHtml;
$('#add-more').onclick = () => input.click();

const logoInput = $('#logo-input');
logoInput.onchange = () => {
  const f = logoInput.files?.[0];
  logoInput.value = '';
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) return toast('That image is over 2 MB — use a smaller one.');
  const reader = new FileReader();
  reader.onload = () => {
    state.logo = reader.result;
    const r = state.reports[state.selected];
    if (r) { r.logo = reader.result; render(); }
    toast('Logo replaced. It applies to reports you generate from now on too.');
  };
  reader.readAsDataURL(f);
};
$('#restart').onclick = () => {
  Object.assign(state, { terms: [], selected: '', setups: {}, reports: {}, statuses: {},
    submissions: [], files: [], issues: [], notes: [] });
  $('#workspace').hidden = true;
  $('#upload').hidden = false;
  $('#up-status').hidden = true;
  $('#up-log').hidden = true;
  $('#up-error').hidden = true;
};
