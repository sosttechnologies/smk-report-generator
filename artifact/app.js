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
  method: 'spreadsheet', filename: '', issues: [], unmapped: [], notes: [], count: 0,
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
async function handleFile(file) {
  const status = $('#up-status');
  const err = $('#up-error');
  err.hidden = true;
  status.hidden = false;
  const progress = (m) => { status.textContent = m; };
  progress('Reading ' + file.name + '…');

  try {
    const spreadsheet = /\.(xlsx|xlsm|csv)$/i.test(file.name);
    const res = spreadsheet ? await readSpreadsheet(file) : await extractFromDocument(file, progress);
    if (!res.submissions.length) {
      throw new Error(spreadsheet
        ? 'No usable submissions in that file. Check it is the Microsoft Forms response export.'
        : 'No tutor submissions could be read. If that is a blank form template, upload a completed one or the Forms export.');
    }
    state.terms = E.aggregateSubmissions(res.submissions);
    state.method = spreadsheet ? 'spreadsheet' : 'document';
    state.filename = file.name;
    state.issues = res.issues ?? [];
    state.unmapped = res.unmappedHeaders ?? [];
    state.notes = res.notes ?? [];
    state.count = res.submissions.length;
    state.selected = state.terms[0].id;
    state.setups = Object.fromEntries(state.terms.map((t) => [t.id, E.defaultSetup(t)]));
    state.reports = {}; state.statuses = {};
    $('#upload').hidden = true;
    $('#workspace').hidden = false;
    render();
  } catch (e) {
    status.hidden = true;
    err.textContent = e?.message || 'Could not read that file.';
    err.hidden = false;
  }
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

  $('#file-label').textContent = `${state.filename} · ${state.count} submissions`;

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
  $('#print').hidden = !locked;
  $('#save').hidden = !locked || !downloads;

  const note = $('#note');
  if (report?.provenance) {
    note.textContent = report.provenance;
    note.dataset.kind = report.templateGenerated ? 'template' : 'claude';
    note.hidden = false;
  } else {
    note.hidden = true;
  }

  $('#empty').hidden = !!report;
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
  const subjects = matrix.map((m) => m.subject);
  const root = $('#paper'); root.innerHTML = '';

  const page = () => { const p = el('section', 'sheet'); root.append(p);
    p.innerHTML = `<img class="rlogo" src="smk-logo.svg" alt="SMK Gateway">`; return p; };

  const foot = (p) => { p.insertAdjacentHTML('beforeend',
    `<div class="rfoot"><div class="rfoot-row"><span><i>&#9679;</i> Ground Floor, 599 Avebury Boulevard, Milton Keynes MK9 3HR</span><span><i>&#9679;</i> 07908 166 261</span><span><i>&#9679;</i> info@sievemk.org.uk</span></div><div class="rlegal">A company limited by guarantee (number 7886477) and a Registered Charity (number 1146451)</div></div>`); };

  // page 1
  const p1 = page();
  p1.insertAdjacentHTML('beforeend', `<div class="rtitle"><div>INTERIM TERMLY REPORT</div><div>REPORTING DATE: ${esc(setup.reportingDateLabel)}</div></div>
    <div class="rmeta"><div>STUDENT: ${esc(report.studentName.toUpperCase())}</div><div>YEAR: ${esc(setup.year || '—')}</div>
    <div>ACADEMIC YEAR: ${esc(setup.academicYear)}</div><div>TERM: ${esc(setup.termLabel)}</div></div>
    <div class="rlabel">OVERVIEW</div>`);
  p1.append(field(content.overview, locked, (v) => { content.overview = v; }, 'Overview'));
  foot(p1);

  // page 2 — matrix
  const p2 = page();
  const table = el('table', 'matrix');
  table.innerHTML = `<thead><tr><th>Subject and Tier</th><th>Attitude To Learning</th><th>Behaviour For Learning</th>
    <th>Contribution In Lessons</th><th>Curriculum Strengths</th><th>Curriculum Areas For Development</th>
    <th>Average score/grade on tests and mocks</th><th>Tutor Assessed Progress</th></tr></thead>`;
  const tb = el('tbody');
  matrix.forEach((r) => {
    const tr = el('tr');
    tr.append(el('td', null, E.subjectWithTier(r.subject, r.tier)));
    const cell = (key, aria) => { const td = el('td'); td.append(field(r[key], locked, (v) => { r[key] = v; }, aria)); return td; };
    tr.append(cell('attitudeToLearning', `Attitude, ${r.subject}`), cell('behaviourForLearning', `Behaviour, ${r.subject}`),
      cell('contributionInLessons', `Contribution, ${r.subject}`), cell('curriculumStrengths', `Strengths, ${r.subject}`),
      cell('curriculumAreasForDevelopment', `Areas for development, ${r.subject}`), cell('averageGrade', `Average grade, ${r.subject}`),
      cell('tutorAssessedProgress', `Progress, ${r.subject}`));
    tb.append(tr);
  });
  table.append(tb); p2.append(table); foot(p2);

  // page 3 — attendance + cognition
  const p3 = page();
  const d3 = el('table', 'detail'); const b3 = el('tbody');
  const attTd = el('td');
  attTd.append(field(content.attendanceNarrative, locked, (v) => { content.attendanceNarrative = v; }, 'Attendance narrative'));
  attTd.insertAdjacentHTML('beforeend', `<table class="att"><thead><tr><th>Week beginning</th><th>Subjects</th><th>Attendance</th><th>Punctuality</th></tr></thead><tbody>
    ${attendance.summary.map((w) => `<tr><td>${fmtWeek(w.weekBeginning)}</td><td>${esc(w.subjects.join(', '))}</td><td>${ATT[w.attendance]}</td><td>${w.punctuality ?? '—'}</td></tr>`).join('')}
    <tr><td colspan="2"><strong>Total</strong></td><td colspan="2"><strong>${attendance.fullWeeks} of ${attendance.distinctWeeks} weeks in full</strong></td></tr></tbody></table>`);
  const r3a = el('tr'); r3a.append(labCell('Attendance'), attTd); b3.append(r3a);
  const cogTd = el('td');
  cogTd.append(field(content.cognitionAndLearning, locked, (v) => { content.cognitionAndLearning = v; }, 'Cognition and learning'));
  const r3b = el('tr'); r3b.append(labCell('Cognition and Learning'), cogTd); b3.append(r3b);
  d3.append(b3); p3.append(d3); foot(p3);

  // page 4 — successes + challenges
  const p4 = page();
  const d4 = el('table', 'detail'); const b4 = el('tbody');
  const group = (src, key) => {
    const td = el('td');
    subjects.forEach((s) => {
      td.append(el('div', 'subhead', s.toUpperCase()));
      td.append(listField(src[s], locked, (items) => { src[s] = items; }, `${key} for ${s}`));
    });
    return td;
  };
  const r4a = el('tr'); r4a.append(labCell('Successes and Achievements'), group(content.successes, 'successes')); b4.append(r4a);
  const r4b = el('tr'); r4b.append(labCell('Challenges or Concerns'), group(content.challenges, 'challenges')); b4.append(r4b);
  d4.append(b4); p4.append(d4); foot(p4);

  // page 5 — targets + observations
  const p5 = page();
  const d5 = el('table', 'detail'); const b5 = el('tbody');
  const tTd = el('td'); tTd.append(listField(content.targets, locked, (v) => { content.targets = v; }, 'Targets or goals'));
  const r5a = el('tr'); r5a.append(labCell('Targets or Goals'), tTd); b5.append(r5a);
  const simple = (label, key, aria) => {
    const td = el('td'); td.append(field(content[key], locked, (v) => { content[key] = v; }, aria));
    const tr = el('tr'); tr.append(labCell(label), td); b5.append(tr);
  };
  simple('Communication and Interaction', 'communicationAndInteraction', 'Communication and interaction');
  simple('Social, Emotional and Mental Health', 'socialEmotionalMentalHealth', 'Social, emotional and mental health');
  simple('Sensory and/or Physical Observations', 'sensoryPhysical', 'Sensory and physical observations');
  d5.append(b5); p5.append(d5); foot(p5);
}

function labCell(text) { const td = el('td', 'lab', text); return td; }

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
      content = coerce(await sample.json(promptFor(term), { modelTier: 'complex' }), term, fallback);
      templated = false;
    } catch (e) {
      note = (e?.code === 'not_granted' ? 'Claude access was declined' : e?.message || 'Claude could not draft this') + ' — drafted from the offline template instead.';
    }
  } else {
    note = 'Claude is not available in this view — drafted from the offline template.';
  }

  state.reports[state.selected] = {
    studentId: term.id, studentName: term.studentName, setup,
    matrix: E.buildMatrix(term, setup, content), content,
    attendance: term.attendance, templateGenerated: templated,
    provenance: templated
      ? (note || 'Assembled offline from the tutors\u2019 own words \u2014 no model was used.')
      : 'Drafted by Claude from the tutor submissions, using your Claude account. Check every section before approving.',
  };
  state.statuses[state.selected] = 'draft';
  render();
}

/* ---------- export ---------- */
function reportHtml(report) {
  const clone = $('#paper').cloneNode(true);
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
@page{size:A4;margin:0}</style></head><body><div id="paper">${clone.innerHTML}</div>${prov}</body></html>`;
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
    toast('Saved. Open it and print to PDF for the letterhead copy.');
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
input.onchange = () => { const f = input.files?.[0]; if (f) handleFile(f); input.value = ''; };
const drop = $('#dropzone');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); });

$('#generate').onclick = generate;
$('#approve').onclick = () => {
  state.statuses[state.selected] = 'approved';
  render();
  toast(`${state.terms.find((t) => t.id === state.selected).studentName.split(' ')[0]}'s report approved`);
};
$('#reopen').onclick = () => { state.statuses[state.selected] = 'draft'; render(); };
$('#print').onclick = () => window.print();
$('#save').onclick = saveHtml;
$('#restart').onclick = () => { $('#workspace').hidden = true; $('#upload').hidden = false; $('#up-status').hidden = true; };
