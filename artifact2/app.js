/* SMK Gateway — Termly Report Generator.
   Built to design_handoff_smk_report_generator/README.md.
   The data layer (parsing, aggregation, derived ratings, pseudonymisation,
   offline drafting) is engine.js, shared with the Next.js app. */

import * as E from './engine.js';

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const uid = () => Math.random().toString(36).slice(2, 10);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtWeek = (iso) => { const d = new Date(iso); return isNaN(d) ? iso : `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const ATTW = { full: 'Full attendance', partial: 'Some absence', none: 'Absent' };
const initials = (n) => String(n).trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

/* ================= capabilities ================= */
let sample = null, downloads = null;
(async () => {
  sample = await window.claude?.use?.('sample').catch(() => null) ?? null;
  downloads = await window.claude?.use?.('downloads').catch(() => null) ?? null;
})();

/* ================= template ================= */
function defaultTemplate() {
  return {
    logo: null, logoPos: 'left', logoSize: 140,
    header: {
      title: 'INTERIM TERMLY REPORT', date: 'REPORTING DATE: 4 MAY TO 11 JUNE 2026',
      studentLabel: 'STUDENT', yearLabel: 'YEAR',
      academicLabel: 'ACADEMIC YEAR', termLabel: 'TERM',
    },
    footer: {
      addr: 'Ground Floor, 599 Avebury Boulevard, Milton Keynes MK9 3HR',
      phone: '07908 166 261', email: 'info@sievemk.org.uk',
      legal: 'A company limited by guarantee (number 7886477) and a Registered Charity (number 1146451)',
    },
    guidance:
      'Warm, professional and specific. Third person, British spelling. Say only what the tutors '
      + 'actually recorded — never add an achievement, grade, diagnosis or family circumstance. '
      + 'Be constructive about difficulties; these reports are read by families.',
    matrixHeaders: [
      'Subject and Tier', 'Attitude To Learning', 'Behaviour For Learning', 'Contribution In Lessons',
      'Curriculum Strengths', 'Curriculum Areas For Development',
      'Average score/grade on tests and mocks', 'Tutor Assessed Progress',
    ],
    sections: [
      { id: 'overview',   label: 'OVERVIEW', source: 'All comments across the term', instr: '2–3 sentences introducing progress, naming the subjects studied.', on: true, pinned: true },
      { id: 'table',      label: 'SUBJECT TABLE', source: 'Q6 and Q7 rating grids', instr: 'Derived from the tutor ratings.', on: true, pinned: true },
      { id: 'attendance', label: 'ATTENDANCE', source: 'Q5 weekly attendance · Q6 punctuality', instr: '2–3 sentences, consistent with the computed figures.', on: true },
      { id: 'cognition',  label: 'COGNITION AND LEARNING', source: 'Q7 academics · Q10 comments', instr: '4–6 paragraphs covering engagement and progress per subject.', on: true },
      { id: 'successes',  label: 'SUCCESSES AND ACHIEVEMENTS', source: 'Q10 general comments', instr: 'Bullets grouped under each subject heading. 4–6 per subject.', on: true },
      { id: 'challenges', label: 'CHALLENGES OR CONCERNS', source: 'Q8 concerns', instr: 'Bullets grouped under each subject heading. Constructive.', on: true },
      { id: 'targets',    label: 'TARGETS OR GOALS', source: 'Q9 key actions', instr: '6–12 short actionable targets across all subjects.', on: true },
      { id: 'comms',      label: 'COMMUNICATION AND INTERACTION', source: 'Q10 general comments', instr: '2–3 sentences on communication with staff and peers.', on: true },
      { id: 'semh',       label: 'SOCIAL, EMOTIONAL AND MENTAL HEALTH', source: 'Q8 · Q10', instr: 'Only what tutors recorded. Otherwise say none identified.', on: true },
      { id: 'sensory',    label: 'SENSORY AND/OR PHYSICAL OBSERVATIONS', source: 'Q10 general comments', instr: 'Only what tutors reported, e.g. fatigue. Otherwise none identified.', on: true },
    ],
  };
}

/* ================= state ================= */
const LS = 'smk-report-generator-v1';

const state = {
  user: { name: 'Precious Joshua', org: 'SMK Gateway' },
  projects: [], reports: [], template: defaultTemplate(),
  screen: 'upload', activeProject: null, activeReport: null,
  selSection: null, search: '', upload: null, gen: null,
};

function save() {
  try {
    localStorage.setItem(LS, JSON.stringify({
      projects: state.projects, reports: state.reports, template: state.template, user: state.user,
    }));
  } catch { /* private window, quota — the app still works, it just won't persist */ }
}

function load() {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (Array.isArray(d.projects)) state.projects = d.projects;
    if (Array.isArray(d.reports)) state.reports = d.reports;
    if (d.template) state.template = { ...defaultTemplate(), ...d.template };
    if (d.user) state.user = d.user;
  } catch { /* corrupt store: start fresh rather than crash */ }
}

function ensureProject() {
  if (!state.projects.length) state.projects.push({ id: uid(), name: 'My first project' });
  if (!state.activeProject) state.activeProject = state.projects[0].id;
  return state.activeProject;
}

const projectOf = (id) => state.projects.find((p) => p.id === id);
const reportOf = (id) => state.reports.find((r) => r.id === id);
const reportsIn = (pid) => state.reports.filter((r) => r.projectId === pid);

/* ================= reading uploads ================= */
async function readSpreadsheet(file) {
  if (/\.csv$/i.test(file.name)) {
    const p = Papa.parse(await file.text(), { header: true, skipEmptyLines: 'greedy' });
    return E.rowsToSubmissions(p.data, p.meta.fields ?? []);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const sh = wb.worksheets[0];
  if (!sh) return { submissions: [], issues: [], unmappedHeaders: [] };
  const hs = [];
  sh.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { hs[i - 1] = String(c.value ?? '').trim(); });
  const rows = [];
  sh.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const rec = {};
    hs.forEach((h, i) => {
      if (!h) return;
      const v = row.getCell(i + 1).value;
      rec[h] = v instanceof Date ? v : v && typeof v === 'object' ? String(v.text ?? v.result ?? '') : v;
    });
    rows.push(rec);
  });
  return E.rowsToSubmissions(rows, hs.filter(Boolean));
}

async function documentText(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith('.pdf')) {
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.5.438/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/6.5.438/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const c = await (await doc.getPage(p)).getTextContent();
      out.push(c.items.map((i) => i.str).join(' '));
    }
    return out.join('\n\n');
  }
  if (n.endsWith('.docx')) return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  return file.text();
}

/* The documents SMK actually hold are weekly Word/PDF reports whose headings differ
   from the Microsoft Form's question numbers, so the prompt describes BOTH shapes. */
const EXTRACT = `You extract tutor submissions from a document for SMK Gateway, a UK education charity.

Each submission covers ONE student, ONE subject and ONE week. It may appear as:
 (a) a row of a Microsoft Forms export with questions Q1–Q10, or
 (b) a "WEEKLY PROGRESS REPORT" document with headed sections.

Map whichever you find onto these fields:
- studentName        ← "STUDENT" / Q1 Student name
- instructorName     ← "INSTRUCTOR" / "INSTRUCTURE NAME" / Q2
- subject            ← "SUBJECT" / Q3 (keep the full name, e.g. "GCSE Mathematics")
- weekBeginning      ← "REPORTING WEEK" / "WEEK COMMENCING" / Q4. ISO yyyy-mm-dd; dd/MM/yyyy is day-first (British)
- weeklyAttendance   ← "Weekly Attendance Status" / Q5. "100%"→full, "0%"→none, "absent on some day"→partial
- engagement         ← the Student Engagement side of a PERFORMANCE & ENGAGEMENT MATRIX, or Q6.
                       Keys exactly: Attendance, Punctuality, Preparation for Class, Homework completion.
                       ("Preparation for class" maps to "Preparation for Class". Ignore "Overall Engagement".)
- academics          ← the Academic Competency side of the matrix, or Q7. Keys exactly:
                       Meets Deadlines, Quality of work, Understands key terms,
                       Applies knowledge and understanding to new concepts, Acts on feedback
- concerns           ← "AREAS FOR DEVELOPMENT & CONCERNS" / "Key Concerns" / Q8
- keyActions         ← "Next Steps" / "Key Actions" / Q9 (empty string if absent)
- generalComments    ← "CURRICULUM PROGRESS & SUCCESSES" / "Strengths & Achievements" / Q10

Rules:
- One object per submission; a document may hold several.
- Transcribe free text EXACTLY, keeping bullet points as separate sentences. Never summarise.
- Ratings are one of Excellent, Good, Average, Poor, Not applicable, or null if absent.
- Never invent. A blank unfilled template yields an empty submissions array.

Reply with ONLY this JSON:
{"submissions":[{"studentName":"","instructorName":"","subject":"","weekBeginning":"YYYY-MM-DD",
"weeklyAttendance":"full|none|partial",
"engagement":{"Attendance":null,"Punctuality":null,"Preparation for Class":null,"Homework completion":null},
"academics":{"Meets Deadlines":null,"Quality of work":null,"Understands key terms":null,"Applies knowledge and understanding to new concepts":null,"Acts on feedback":null},
"concerns":"","keyActions":"","generalComments":""}],"notes":[]}

DOCUMENT:
`;

async function extractDoc(file, onProgress) {
  if (!sample) throw new Error('Reading PDF, Word and image files needs Claude, which this view cannot reach. Upload the Forms .xlsx or .csv export instead — that is read without a model.');
  const isImg = /\.(png|jpe?g|gif|webp)$/i.test(file.name);
  let result;
  if (isImg) {
    const lim = await sample.limits().catch(() => ({}));
    if (!lim.images) throw new Error('This view cannot send images to Claude. Try a PDF, Word file or the Forms export.');
    onProgress?.('Claude is reading the image…');
    result = await sample.json(EXTRACT + '(see attached image)', { images: [file], modelTier: 'complex' });
  } else {
    const text = await documentText(file);
    if (!text.trim()) throw new Error('No readable text. If this is a scanned PDF, upload it as an image instead.');
    onProgress?.('Claude is reading the document…');
    result = await sample.json(EXTRACT + text.slice(0, 120000), { modelTier: 'complex' });
  }
  const rows = Array.isArray(result?.submissions) ? result.submissions : [];
  const clean = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v && v !== 'Not applicable'));
  const submissions = rows.map((r, i) => {
    const subject = E.canonicalSubject(r.subject);
    const wk = E.parseWeekBeginning(r.weekBeginning);
    return {
      id: `${E.studentKey(r.studentName)}|${subject}|${wk ?? i}`,
      studentName: String(r.studentName ?? '').trim().replace(/\s+/g, ' '),
      instructorName: String(r.instructorName ?? '').trim(),
      subject, weekBeginning: wk,
      weeklyAttendance: ['full', 'none', 'partial'].includes(r.weeklyAttendance) ? r.weeklyAttendance : 'partial',
      engagement: clean(r.engagement), academics: clean(r.academics),
      concerns: String(r.concerns ?? ''), keyActions: String(r.keyActions ?? ''),
      generalComments: String(r.generalComments ?? ''),
    };
  }).filter((s) => s.studentName && s.subject && s.weekBeginning);
  return { submissions, issues: [], unmappedHeaders: [], notes: Array.isArray(result?.notes) ? result.notes : [] };
}

const SPREAD = /\.(xlsx|xlsm|csv)$/i;
const badgeFor = (name) => {
  const e = (name.split('.').pop() || '').toLowerCase();
  if (e === 'xlsx' || e === 'xlsm') return ['XLSX', '#E7F3EC', '#1E6B43'];
  if (e === 'csv') return ['CSV', '#E3F1F0', '#17605C'];
  if (e === 'pdf') return ['PDF', '#F8E9E6', '#9A3524'];
  if (e === 'docx' || e === 'doc') return ['DOCX', '#E8EDF8', '#2B4C9A'];
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e)) return ['IMG', '#F3EDE2', '#7A5A1E'];
  return [e.toUpperCase().slice(0, 4) || 'FILE', '#EFECE6', '#6B6862'];
};

async function readOne(file, onProgress) {
  const spread = SPREAD.test(file.name);
  try {
    const r = spread ? await readSpreadsheet(file) : await extractDoc(file, onProgress);
    return {
      name: file.name, size: file.size, spread, ok: r.submissions.length > 0,
      submissions: r.submissions, issues: r.issues ?? [], notes: r.notes ?? [],
      detail: r.submissions.length
        ? `${r.submissions.length} response${r.submissions.length === 1 ? '' : 's'} · ${[...new Set(r.submissions.map((s) => s.subject))].join(', ')}`
        : '',
      error: r.submissions.length ? null
        : spread ? 'No usable responses — is this the Forms export?' : 'No tutor responses found in this document.',
    };
  } catch (e) {
    return { name: file.name, size: file.size, spread, ok: false, submissions: [], issues: [], notes: [], detail: '', error: e?.message || 'Could not read this file.' };
  }
}

/* ================= content model ================= */
/* Blocks: {type:'p'|'h'|'li', text}. One array per section id. */
const P = (t) => ({ type: 'p', text: t });
const H = (t) => ({ type: 'h', text: t });
const LI = (t) => ({ type: 'li', text: t });

function contentToBlocks(c, term) {
  const subjects = term.subjects.map((s) => s.subject);
  const grouped = (src) => subjects.flatMap((s) => [H(s.toUpperCase()), ...(src[s] ?? []).filter(Boolean).map(LI)]);
  return {
    overview: String(c.overview).split(/\n{2,}/).filter(Boolean).map(P),
    attendance: [P(c.attendanceNarrative)],
    cognition: String(c.cognitionAndLearning).split(/\n{2,}/).filter(Boolean).map(P),
    successes: grouped(c.successes),
    challenges: grouped(c.challenges),
    targets: (c.targets ?? []).filter(Boolean).map(LI),
    comms: [P(c.communicationAndInteraction)],
    semh: [P(c.socialEmotionalMentalHealth)],
    sensory: [P(c.sensoryPhysical)],
  };
}

/* Sections whose text mentions health or private detail get a CHECK · MEDICAL tag. */
function flagSections(blocks, term) {
  const risky = E.findResidualRisks(term);
  const flags = {};
  if (!risky.length) return flags;
  const needles = risky.map((r) => r.text.toLowerCase().slice(0, 40));
  for (const [id, bs] of Object.entries(blocks)) {
    const text = bs.map((b) => b.text).join(' ').toLowerCase();
    if (needles.some((n) => n && text.includes(n.slice(0, 24)))) flags[id] = true;
  }
  if (!Object.keys(flags).length) { flags.semh = true; flags.sensory = true; }
  return flags;
}

/* ================= generation ================= */
function promptFor(term, tpl, sections) {
  const L = [];
  L.push(`STUDENT: ${term.studentName}`);
  L.push(`REPORTING PERIOD: week beginning ${term.firstWeek} to week beginning ${term.lastWeek}`);
  L.push('');
  L.push('ATTENDANCE (computed from the forms — do not contradict these figures):');
  L.push(`- ${term.attendance.fullWeeks} of ${term.attendance.distinctWeeks} weeks in full; ${term.attendance.partialWeeks} with some absence; ${term.attendance.absentWeeks} missed entirely.`);
  L.push(`- Most common punctuality rating: ${term.attendance.modalPunctuality ?? 'not recorded'}`);
  L.push('');
  for (const s of term.subjects) {
    L.push(`SUBJECT: ${s.subject} (tutors: ${s.instructors.join(', ') || 'not recorded'}, ${s.weekCount} weeks)`);
    L.push(`  Derived — attitude ${s.attitudeToLearning}; behaviour ${s.behaviourForLearning}; contribution ${s.contributionInLessons}; progress ${s.tutorAssessedProgress}`);
    L.push('  General comments:'); s.generalComments.forEach((c) => L.push('   - ' + c));
    L.push('  Concerns:'); s.concerns.forEach((c) => L.push('   - ' + c));
    L.push('  Key actions:'); s.keyActions.forEach((c) => L.push('   - ' + c));
    L.push('');
  }
  const keys = term.subjects.map((s) => s.subject);
  const on = (id) => sections.some((x) => x.id === id && x.on);
  const instr = (id) => sections.find((x) => x.id === id)?.instr ?? '';

  const shape = [];
  if (on('overview')) shape.push(`"overview":"${instr('overview')}"`);
  shape.push(`"subjects":{${keys.map((k) => `${JSON.stringify(k)}:{"curriculumStrengths":"short table-cell phrase","areasForDevelopment":"short table-cell phrase"}`).join(',')}}`);
  if (on('attendance')) shape.push(`"attendanceNarrative":"${instr('attendance')}"`);
  if (on('cognition')) shape.push(`"cognitionAndLearning":"${instr('cognition')} Separate paragraphs with \\n\\n."`);
  if (on('successes')) shape.push(`"successes":{${keys.map((k) => `${JSON.stringify(k)}:["bullets"]`).join(',')}}`);
  if (on('challenges')) shape.push(`"challenges":{${keys.map((k) => `${JSON.stringify(k)}:["bullets"]`).join(',')}}`);
  if (on('targets')) shape.push(`"targets":["${instr('targets')}"]`);
  if (on('comms')) shape.push(`"communicationAndInteraction":"${instr('comms')}"`);
  if (on('semh')) shape.push(`"socialEmotionalMentalHealth":"${instr('semh')}"`);
  if (on('sensory')) shape.push(`"sensoryPhysical":"${instr('sensory')}"`);

  return `You write termly progress reports for SMK Gateway (SIEVEMK Gateway), a UK education charity in Milton Keynes tutoring students aged 11 and over.

HOUSE STYLE: ${tpl.guidance}

Absolute rules:
- Use ONLY facts in the submissions below. Never invent an achievement, grade, diagnosis, family circumstance or concern.
- Where there is nothing recorded for a section, say so plainly and ask staff to review. Do not pad.
- Never speculate about medical, psychological or safeguarding matters; report fatigue or medication only as the tutor described it.
- The student is "Student A" and tutors are "Tutor 1", "Tutor 2". Use those names exactly; never guess a real name.

${L.join('\n')}
Reply with ONLY this JSON object:
{${shape.join(',\n')}}`;
}

function coerce(raw, term, fallback) {
  if (!raw || typeof raw !== 'object') return fallback;
  const st = (v, f) => (typeof v === 'string' && v.trim() ? v.trim() : f);
  const ar = (v, f) => (Array.isArray(v) && v.length ? v.map(String).filter(Boolean) : f);
  const subjects = {}, successes = {}, challenges = {};
  for (const s of term.subjects) {
    const k = s.subject;
    subjects[k] = {
      curriculumStrengths: st(raw.subjects?.[k]?.curriculumStrengths, fallback.subjects[k].curriculumStrengths),
      areasForDevelopment: st(raw.subjects?.[k]?.areasForDevelopment, fallback.subjects[k].areasForDevelopment),
    };
    successes[k] = ar(raw.successes?.[k], fallback.successes[k] ?? []);
    challenges[k] = ar(raw.challenges?.[k], fallback.challenges[k] ?? []);
  }
  return {
    overview: st(raw.overview, fallback.overview), subjects,
    attendanceNarrative: st(raw.attendanceNarrative, fallback.attendanceNarrative),
    cognitionAndLearning: st(raw.cognitionAndLearning, fallback.cognitionAndLearning),
    successes, challenges,
    targets: ar(raw.targets, fallback.targets),
    communicationAndInteraction: st(raw.communicationAndInteraction, fallback.communicationAndInteraction),
    socialEmotionalMentalHealth: st(raw.socialEmotionalMentalHealth, fallback.socialEmotionalMentalHealth),
    sensoryPhysical: st(raw.sensoryPhysical, fallback.sensoryPhysical),
  };
}

const STEPS = (n, s) => ([
  `Reading ${n} file${n === 1 ? '' : 's'}`,
  'Working out the subject table',
  'Checking comments for private details',
  `Drafting ${s} sections with your template`,
  'Matching your example report',
]);

async function runGeneration(term, meta) {
  if (runGeneration.busy) return;
  runGeneration.busy = true;
  const tpl = state.template;
  const enabled = tpl.sections.filter((x) => x.on && x.id !== 'table');
  state.gen = { steps: STEPS(state.upload?.files?.length ?? 1, enabled.length), at: 0, done: false, title: `Writing ${term.studentName.split(' ')[0]}'s report…` };
  render();

  const tick = async (i, ms = 420) => { state.gen.at = i; render(); await new Promise((r) => setTimeout(r, ms)); };
  await tick(0, 300);
  await tick(1, 380);
  await tick(2, 320);

  const fallback = E.generateFromTemplate(term);
  let content = fallback, templated = true, note = '';
  state.gen.at = 3; render();

  if (sample) {
    try {
      const { term: masked, pseudonym } = E.pseudonymise(term);
      const raw = await sample.json(promptFor(masked, tpl, tpl.sections), { modelTier: 'complex' });
      content = coerce(E.rehydrate(raw, pseudonym), term, fallback);
      templated = false;
    } catch (e) {
      note = (e?.code === 'not_granted' ? 'Claude access was declined' : e?.message || 'Claude could not draft this') + ' — written from the offline template instead.';
    }
  } else {
    note = 'Claude is not available in this view — written from the offline template.';
  }

  await tick(4, 320);
  state.gen.done = true; state.gen.title = 'The draft is ready.'; render();
  await new Promise((r) => setTimeout(r, 420));

  const blocks = contentToBlocks(content, term);
  const flags = flagSections(blocks, term);
  const report = {
    id: uid(), projectId: meta.projectId, student: term.studentName, keyStage: meta.keyStage || '',
    status: 'Draft', updatedAt: Date.now(), createdAt: Date.now(),
    term, blocks, flags, reviewed: {}, history: {},
    matrix: E.buildMatrix(term, { tiers: {}, averageGrades: {} }, content),
    header: { ...tpl.header }, footer: { ...tpl.footer }, logo: tpl.logo,
    provenance: templated
      ? (note || 'Written offline from the tutors’ own words — no model was used.')
      : 'Drafted by Claude. Names were replaced with “Student A” before sending and restored here.',
    templated,
  };
  state.reports.unshift(report);
  state.activeReport = report.id;
  state.selSection = null;
  state.gen = null;
  state.upload = null;
  state.screen = 'report';
  runGeneration.busy = false;
  save(); render();
}

/* ================= toast / confirm / menu ================= */
let toastTimer, undoLiveUntil = 0;
function toast(msg, undo) {
  const t = $('#toast');
  // An undo toast is a time-limited offer. A plain notice arriving behind it must
  // not steal the slot, or the only route back is gone without the user seeing it.
  if (!undo && Date.now() < undoLiveUntil) return;
  undoLiveUntil = undo ? Date.now() + 6000 : 0;
  t.innerHTML = '';
  t.append(el('span', null, msg));
  if (undo) {
    const b = el('button', null, 'Undo');
    b.onclick = () => { undo(); t.hidden = true; clearTimeout(toastTimer); };
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; undoLiveUntil = 0; }, undo ? 6000 : 3400);
}

function closeOverlay() { $('#overlay').innerHTML = ''; }

function confirmDialog({ title, body, danger = 'Delete', onYes }) {
  const scrim = el('div', 'scrim');
  const m = el('div', 'modal');
  m.style.maxWidth = '420px';
  m.append(el('h2', null, title));
  m.append(Object.assign(el('p'), { textContent: body, style: 'color:var(--muted);font-size:13.5px;margin:6px 0 18px' }));
  const row = el('div');
  row.style.cssText = 'display:flex;gap:9px;justify-content:flex-end';
  const cancel = el('button', 'btn-2', 'Cancel'); cancel.onclick = closeOverlay;
  const yes = el('button', 'btn', danger);
  yes.style.background = 'oklch(0.5 0.17 27)';
  yes.onclick = () => { closeOverlay(); onYes(); };
  row.append(cancel, yes); m.append(row); scrim.append(m);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) closeOverlay(); });
  $('#overlay').append(scrim);
  yes.focus();
}

function popMenu(anchor, items) {
  closeOverlay();
  const r = anchor.getBoundingClientRect();
  const m = el('div', 'menu');
  m.style.left = `${Math.min(r.left, innerWidth - 170)}px`;
  m.style.top = `${r.bottom + 4}px`;
  for (const it of items) {
    const b = el('button', it.danger ? 'btn-danger' : null, it.label);
    b.onclick = (e) => { e.stopPropagation(); closeOverlay(); it.run(); };
    m.append(b);
  }
  $('#overlay').append(m);
  setTimeout(() => document.addEventListener('click', closeOverlay, { once: true }), 0);
}

/* ================= sidebar ================= */
function groupRecents(list) {
  const now = Date.now(), day = 864e5;
  const g = { Today: [], 'Previous 7 days': [], Earlier: [] };
  for (const r of list) {
    const age = now - (r.updatedAt || 0);
    (age < day ? g.Today : age < 7 * day ? g['Previous 7 days'] : g.Earlier).push(r);
  }
  return g;
}

function renderSidebar() {
  $('#acct-name').textContent = state.user.name;
  $('#acct-ini').textContent = initials(state.user.name);

  const pc = $('#projects'); pc.innerHTML = '';
  for (const p of state.projects) {
    const b = el('button', 'side-item' + (state.screen === 'project' && state.activeProject === p.id ? ' on' : ''));
    const n = reportsIn(p.id).length;
    b.innerHTML = `<span class="l1">▸ ${esc(p.name)} <span style="color:var(--faint);font-weight:400">${n || ''}</span></span>`;
    b.onclick = () => { state.activeProject = p.id; state.screen = 'project'; render(); };
    const d = el('button', 'dots', '⋯');
    d.setAttribute('aria-label', `Options for ${p.name}`);
    d.onclick = (e) => {
      e.stopPropagation();
      popMenu(d, [
        { label: 'Rename', run: () => renameProject(p.id) },
        { label: 'Delete', danger: true, run: () => deleteProject(p.id) },
      ]);
    };
    b.append(d); pc.append(b);
  }

  const q = state.search.trim().toLowerCase();
  const list = state.reports
    .filter((r) => !q || r.student.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const rc = $('#recents'); rc.innerHTML = '';
  if (!list.length && q) {
    rc.append(Object.assign(el('div', null, 'No reports match.'), { style: 'padding:14px 10px;font-size:12.5px;color:var(--faint)' }));
    return;
  }
  for (const [label, items] of Object.entries(groupRecents(list))) {
    if (!items.length) continue;
    const h = el('div', 'side-head');
    h.append(el('span', 'mono', label));
    rc.append(h);
    for (const r of items) {
      const b = el('button', 'side-item' + (state.screen === 'report' && state.activeReport === r.id ? ' on' : ''));
      b.innerHTML = `<span class="l1">${esc(r.student)} — Termly report</span>
        <span class="l2">${esc(projectOf(r.projectId)?.name ?? 'No project')} · ${r.status}</span>`;
      b.onclick = () => { state.activeReport = r.id; state.selSection = null; state.screen = 'report'; render(); };
      const d = el('button', 'dots', '⋯');
      d.setAttribute('aria-label', `Options for ${r.student}'s report`);
      d.onclick = (e) => { e.stopPropagation(); popMenu(d, [{ label: 'Delete', danger: true, run: () => deleteReport(r.id) }]); };
      b.append(d); rc.append(b);
    }
  }
}

function renameProject(id) {
  const p = projectOf(id); if (!p) return;
  const name = prompt('Project name', p.name);
  if (name && name.trim()) { p.name = name.trim(); save(); render(); }
}

function deleteProject(id) {
  const p = projectOf(id); if (!p) return;
  const n = reportsIn(id).length;
  confirmDialog({
    title: `Delete “${p.name}”?`,
    body: n ? `${n} report${n === 1 ? '' : 's'} will be deleted with it.` : 'This project has no reports.',
    onYes: () => {
      const projIdx = state.projects.findIndex((x) => x.id === id);
      const removedProj = state.projects.splice(projIdx, 1)[0];
      const removedReports = state.reports.filter((r) => r.projectId === id);
      state.reports = state.reports.filter((r) => r.projectId !== id);
      if (state.activeProject === id) state.activeProject = state.projects[0]?.id ?? null;
      if (removedReports.some((r) => r.id === state.activeReport)) { state.activeReport = null; state.screen = 'upload'; }
      ensureProject(); save(); render();
      toast(`Deleted “${removedProj.name}”`, () => {
        state.projects.splice(projIdx, 0, removedProj);
        state.reports.push(...removedReports);
        save(); render();
      });
    },
  });
}

function deleteReport(id) {
  const idx = state.reports.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const r = state.reports[idx];
  confirmDialog({
    title: `Delete ${r.student}'s report?`,
    body: 'The draft and every edit will be removed.',
    onYes: () => {
      state.reports.splice(idx, 1);
      if (state.activeReport === id) { state.activeReport = null; state.screen = 'upload'; }
      save(); render();
      toast(`Deleted ${r.student}'s report`, () => { state.reports.splice(idx, 0, r); save(); render(); });
    },
  });
}

/* ================= top bar ================= */
function renderTop() {
  const c = $('#crumb'), a = $('#top-actions');
  c.innerHTML = ''; a.innerHTML = '';
  const proj = projectOf(state.activeProject);
  const crumb = (...parts) => parts.forEach((p, i) => {
    if (i) c.append(Object.assign(el('span', 'sep', '/'), {}));
    c.append(typeof p === 'string' ? el('b', null, p) : p);
  });

  if (state.screen === 'report') {
    const r = reportOf(state.activeReport);
    if (!r) return;
    crumb(projectOf(r.projectId)?.name ?? 'Reports', `${r.student} — Termly report`);
    const secs = state.template.sections.filter((s) => s.on && s.id !== 'table');
    const done = secs.filter((s) => r.reviewed[s.id]).length;
    a.append(Object.assign(el('span', null, `${done} of ${secs.length} sections reviewed`), { style: 'font-size:12.5px;color:var(--muted)' }));
    const t = el('button', 'btn-2', 'Template'); t.onclick = () => { state.screen = 'template'; render(); };
    const s = el('button', 'btn', 'Share & export'); s.onclick = shareModal;
    a.append(t, s);
  } else if (state.screen === 'template') {
    crumb('Report template');
    a.append(Object.assign(el('span', null, 'Changes save automatically'), { style: 'font-size:12.5px;color:var(--muted)' }));
    if (state.activeReport) {
      const b = el('button', 'btn-2', 'Back to report →');
      b.onclick = () => { state.screen = 'report'; render(); };
      a.append(b);
    }
  } else if (state.screen === 'project') {
    crumb(proj?.name ?? 'Project');
  } else if (state.screen === 'upload') {
    crumb(proj?.name ?? 'Reports', 'New report');
  } else if (state.screen === 'generating') {
    crumb(proj?.name ?? 'Reports', 'Generating');
  }
}

/* ================= upload screen ================= */
function screenUpload() {
  const wrap = el('div', 'col');
  const proj = projectOf(ensureProject());
  wrap.append(Object.assign(el('p', 'mono eyebrow'), { textContent: `New report · ${proj.name}` }));
  const h = el('h1', 'display');
  h.append(document.createTextNode("Drop in a student's forms."));
  h.append(Object.assign(el('span', 'alt'), { textContent: 'Get back their termly report.' }));
  wrap.append(h);
  wrap.append(Object.assign(el('p', 'lede'), {
    textContent: 'Weekly tutor forms, Word or PDF progress reports, a Microsoft Forms export — add whatever you have for one student. Everything is read before anything is written.',
  }));

  const drop = el('div'); drop.id = 'drop';
  drop.innerHTML = `<p>Drop files here, or click to choose</p>
    <p class="sub">Forms exports (.xlsx, .csv) are read on this device. PDF, Word and photos are read by Claude.</p>`;
  const pill = el('button', 'pill', "Use George Holmes's Spring forms");
  pill.onclick = (e) => { e.stopPropagation(); loadSample(); };
  drop.append(pill);
  drop.onclick = () => $('#file-input').click();
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  });
  wrap.append(drop);

  const u = state.upload;
  if (u?.files?.length) {
    const fl = el('div', 'files');
    u.files.forEach((f, i) => {
      const [bl, bg, fg] = badgeFor(f.name);
      const row = el('div', 'frow');
      const b = el('div', 'badge', bl); b.style.background = bg; b.style.color = fg;
      const mid = el('div');
      mid.style.minWidth = '0';
      mid.append(Object.assign(el('div', 'nm'), { textContent: f.name }));
      mid.append(Object.assign(el('div', 'de'), { textContent: f.detail || `${(f.size / 1024).toFixed(0)} KB` }));
      const st = el('div', 'st' + (f.ok ? ' done' : f.error ? ' bad' : ''),
        f.status === 'reading' ? 'Reading…' : f.ok ? '✓ Read' : f.error ? 'Failed' : 'Queued');
      if (f.error) st.title = f.error;
      const x = el('button', 'xbtn', '×');
      x.setAttribute('aria-label', `Remove ${f.name}`);
      x.onclick = () => { u.files.splice(i, 1); recomputeUpload(); render(); };
      const bar = el('div', 'bar');
      bar.style.width = f.status === 'reading' ? '55%' : f.ok || f.error ? '100%' : '0';
      if (f.error) bar.style.background = 'var(--priv)';
      row.append(b, mid, st, x, bar);
      fl.append(row);
    });
    wrap.append(fl);

    if (u.failed) {
      wrap.append(Object.assign(el('div'), {
        innerHTML: `<div style="margin-top:12px;background:var(--priv-soft);color:var(--priv);border-radius:9px;padding:11px 13px;font-size:12.5px">${u.failed} file${u.failed === 1 ? '' : 's'} could not be read. The rest are fine — remove them or try a different format.</div>`,
      }));
    }

    if (u.term) {
      const card = el('div', 'card');
      const g = el('div', 'grid3');
      const mk = (label, value, on, opts) => {
        const l = el('label', 'f'); l.append(el('span', null, label));
        if (opts) {
          const sel = el('select');
          for (const o of opts) { const op = el('option', null, o.label); op.value = o.value; if (o.value === value) op.selected = true; sel.append(op); }
          sel.onchange = () => on(sel.value); l.append(sel);
        } else {
          const i = el('input'); i.value = value ?? ''; i.oninput = () => on(i.value); l.append(i);
        }
        return l;
      };
      g.append(
        mk('Student', u.student, (v) => { u.student = v; }),
        mk('Year / Key Stage', u.keyStage, (v) => { u.keyStage = v; }),
        mk('Save to project', u.projectId, (v) => { u.projectId = v; }, state.projects.map((p) => ({ value: p.id, label: p.name }))),
      );
      card.append(g);
      const t = u.term;
      card.append(Object.assign(el('div', 'detect'), {
        textContent: `Found ${t.subjects.length} subject${t.subjects.length === 1 ? '' : 's'} · ${t.submissions.length} weekly response${t.submissions.length === 1 ? '' : 's'} · weeks beginning ${fmtWeek(t.firstWeek)} – ${fmtWeek(t.lastWeek)}`,
      }));
      if (u.multiStudent) {
        card.append(Object.assign(el('div', 'detect'), {
          innerHTML: `<strong style="color:var(--priv)">${u.multiStudent} students detected.</strong> This makes a report for <strong>${esc(u.student)}</strong> only — upload the others separately.`,
        }));
      }
      wrap.append(card);
    }
  }

  const foot = el('div', 'sticky-foot');
  const secs = state.template.sections.filter((s) => s.on);
  const meta = el('div', 'meta');
  meta.innerHTML = `Template: Interim Termly Report · ${secs.length} sections · `;
  const edit = el('button', 'btn-ghost', 'Edit template');
  edit.style.padding = '0'; edit.style.textDecoration = 'underline';
  edit.onclick = () => { state.screen = 'template'; render(); };
  meta.append(edit);
  const go = el('button', 'btn');
  const reading = u?.files?.filter((f) => f.status === 'reading').length ?? 0;
  const ready = !!u?.term && !reading;
  go.textContent = reading ? `Reading ${u.files.length - reading} of ${u.files.length}…` : 'Generate report →';
  go.disabled = !ready;
  go.onclick = () => {
    // Guard against a double or triple click: three synchronous clicks landed
    // before the first render could swap the screen, and made three reports.
    if (state.gen || go.disabled) return;
    if (!u?.student?.trim()) return toast('Add the student’s name first.');
    go.disabled = true;
    state.screen = 'generating';
    runGeneration(u.term, { projectId: u.projectId, keyStage: u.keyStage });
  };
  foot.append(meta, go);
  wrap.append(foot);
  return wrap;
}

/* ================= generating screen ================= */
function screenGenerating() {
  const wrap = el('div', 'col');
  const g = state.gen ?? { steps: [], at: 0, title: 'Working…' };
  const inner = el('div', 'gen-wrap');
  const left = el('div');
  left.append(Object.assign(el('p', 'mono eyebrow'), { textContent: g.done ? 'Ready' : 'Generating' }));
  left.append(Object.assign(el('h1', 'display'), { textContent: g.title }));
  const bar = el('div', 'progress');
  const fill = el('i');
  fill.style.width = `${Math.round(((g.at + (g.done ? 1 : 0)) / Math.max(g.steps.length, 1)) * 100)}%`;
  bar.append(fill); left.append(bar);
  const steps = el('div', 'steps');
  g.steps.forEach((s, i) => {
    const done = g.done || i < g.at;
    const row = el('div', 'step' + (done ? ' done' : i === g.at ? ' active' : ''));
    const ic = el('span', 'ic');
    if (done) { ic.textContent = '✓'; ic.style.color = 'var(--ink)'; }
    else if (i === g.at) ic.append(el('div', 'spinner'));
    else ic.textContent = '·';
    row.append(ic, el('span', null, s));
    steps.append(row);
  });
  left.append(steps);
  const right = el('div', 'skel');
  for (const w of [45, 92, 88, 70, 0, 96, 90, 84, 62, 0, 88, 76]) {
    const i = el('i', w ? 'fade' : null);
    i.style.width = w ? `${w}%` : '100%';
    if (!w) i.style.background = 'transparent';
    right.append(i);
  }
  inner.append(left, right);
  wrap.append(inner);
  return wrap;
}

/* ================= the document ================= */
function editable(tag, cls, text, onSave) {
  const n = el(tag, cls);
  n.textContent = text ?? '';
  n.contentEditable = 'plaintext-only';
  n.spellcheck = false;
  // Compare against the last value this node saved, not the value captured when it
  // was built. Clicking any control blurs the focused node, and comparing against a
  // stale capture made every such blur look like a fresh edit — which corrupted the
  // undo chain, because Undo itself causes a blur before its click handler runs.
  n.dataset.last = text ?? '';
  n.addEventListener('blur', () => {
    const v = n.textContent;
    if (v === n.dataset.last) return;
    n.dataset.last = v;
    onSave(v);
  });
  return n;
}

function docFooter(r) {
  const f = el('div', 'dfoot');
  const row = el('div', 'dfoot-row');
  const bit = (key) => {
    const s = el('span');
    s.innerHTML = '<i>◆</i> ';
    s.append(editable('span', null, r.footer[key], (v) => { r.footer[key] = v; touch(r); }));
    return s;
  };
  row.append(bit('addr'), bit('phone'), bit('email'));
  f.append(row);
  const lg = el('div', 'dlegal');
  lg.append(editable('span', null, r.footer.legal, (v) => { r.footer.legal = v; touch(r); }));
  f.append(lg);
  return f;
}

function docPage(r, auto) {
  const p = el('section', 'sheet' + (auto ? ' auto' : ''));
  const img = el('img', 'dlogo');
  img.src = r.logo || 'smk-logo.png';
  img.alt = 'SMK Gateway';
  img.style.height = `${Math.max(32, Math.min(90, (state.template.logoSize || 140) * 0.37))}px`;
  img.style.marginLeft = state.template.logoPos === 'center' ? 'auto' : '';
  img.style.marginRight = state.template.logoPos === 'center' ? 'auto'
    : state.template.logoPos === 'right' ? '0' : '';
  if (state.template.logoPos === 'right') img.style.marginLeft = 'auto';
  img.title = 'Click to replace the logo';
  img.onclick = () => { logoTarget = 'report'; $('#logo-input').click(); };
  p.append(img);
  return p;
}

function touch(r) { r.updatedAt = Date.now(); if (r.status === 'Shared') r.status = 'Ready'; save(); renderSidebar(); }

function logEdit(r, sectionId, what) {
  (r.history[sectionId] ||= []).push({ at: Date.now(), what });
}

function blockNode(r, sec, blocks, i) {
  const b = blocks[i];
  const tag = b.type === 'li' ? 'li' : b.type === 'h' ? 'div' : 'p';
  const cls = b.type === 'h' ? 'dsub' : null;
  return editable(tag, cls, b.text, (v) => {
    const prev = b.text;
    b.text = v;
    logEdit(r, sec.id, `Edited “${prev.slice(0, 38)}${prev.length > 38 ? '…' : ''}”`);
    r._undo = { sectionId: sec.id, apply: () => { b.text = prev; } };
    touch(r); renderPanel();
  });
}

function sectionBody(r, sec) {
  const host = el('div');
  const blocks = r.blocks[sec.id] ?? [];
  let ul = null;
  blocks.forEach((b, i) => {
    const node = blockNode(r, sec, blocks, i);
    if (b.type === 'li') {
      if (!ul) { ul = el('ul'); host.append(ul); }
      ul.append(node);
    } else { ul = null; host.append(node); }
  });
  if (!blocks.length) host.append(Object.assign(el('p'), { textContent: 'Nothing recorded for this section.', style: 'color:#777' }));
  return host;
}

function renderDocument() {
  const r = reportOf(state.activeReport);
  const host = $('#docscroll');
  host.innerHTML = '';
  if (!r) return;
  const tplSecs = state.template.sections.filter((s) => s.on);
  const has = (id) => tplSecs.some((s) => s.id === id);

  const wrapSection = (sec, node) => {
    const d = el('div', 'dsec' + (state.selSection === sec.id ? ' sel' : ''));
    d.id = `sec-${sec.id}`;
    d.append(node);
    d.onclick = () => { state.selSection = sec.id; renderDocument(); renderPanel(); };
    return d;
  };

  /* page 1 */
  const p1 = docPage(r);
  const title = el('div', 'dtitle');
  title.append(editable('div', null, r.header.title, (v) => { r.header.title = v; touch(r); }));
  title.append(editable('div', null, r.header.date, (v) => { r.header.date = v; touch(r); }));
  p1.append(title);
  const meta = el('div', 'dmeta');
  const metaRow = (labelKey, value, onValue) => {
    const d = el('div');
    d.append(editable('span', null, r.header[labelKey], (v) => { r.header[labelKey] = v; touch(r); }));
    d.append(document.createTextNode(': '));
    d.append(editable('span', null, value, onValue));
    return d;
  };
  meta.append(
    metaRow('studentLabel', r.student.toUpperCase(), (v) => { r.student = v; touch(r); render(); }),
    metaRow('yearLabel', r.keyStage || '—', (v) => { r.keyStage = v; touch(r); }),
    metaRow('academicLabel', r.academicYear || E.academicYearLabel(r.term.firstWeek), (v) => { r.academicYear = v; touch(r); }),
    metaRow('termLabel', r.termLabel || E.termLabel(r.term.firstWeek, r.term.lastWeek), (v) => { r.termLabel = v; touch(r); }),
  );
  p1.append(meta);
  if (has('overview')) {
    const sec = tplSecs.find((s) => s.id === 'overview');
    const body = el('div');
    body.append(editable('div', 'dlabel', sec.label, (v) => { sec.label = v; save(); }));
    body.append(sectionBody(r, sec));
    p1.append(wrapSection(sec, body));
  }
  p1.append(docFooter(r));
  host.append(p1);

  /* page 2 — subject table */
  if (has('table')) {
    const p2 = docPage(r);
    const sec = tplSecs.find((s) => s.id === 'table');
    const t = el('table', 'dtable');
    const thead = el('thead'), htr = el('tr');
    state.template.matrixHeaders.forEach((h, i) => {
      const th = el('th');
      th.append(editable('span', null, h, (v) => { state.template.matrixHeaders[i] = v; save(); }));
      htr.append(th);
    });
    thead.append(htr); t.append(thead);
    const tb = el('tbody');
    r.matrix.forEach((row) => {
      const tr = el('tr');
      const keys = ['subject', 'attitudeToLearning', 'behaviourForLearning', 'contributionInLessons',
        'curriculumStrengths', 'curriculumAreasForDevelopment', 'averageGrade', 'tutorAssessedProgress'];
      keys.forEach((k) => {
        const td = el('td');
        td.append(editable('span', null, row[k] ?? '', (v) => { row[k] = v; touch(r); }));
        tr.append(td);
      });
      tb.append(tr);
    });
    t.append(tb); p2.append(wrapSection(sec, t)); p2.append(docFooter(r));
    host.append(p2);
  }

  /* pages 3+ — label/body rows, paginated so pages stay A4-shaped */
  const rest = tplSecs.filter((s) => s.id !== 'overview' && s.id !== 'table');
  const PER_PAGE = 2;
  for (let i = 0; i < rest.length; i += PER_PAGE) {
    const page = docPage(r, true);
    const t = el('table', 'dl');
    const tb = el('tbody');
    for (const sec of rest.slice(i, i + PER_PAGE)) {
      const tr = el('tr');
      const lab = el('td', 'lab');
      lab.append(editable('span', null, sec.label, (v) => { sec.label = v; save(); }));
      if (r.flags[sec.id] && !r.reviewed[sec.id]) lab.append(Object.assign(el('span', 'tag med'), { textContent: 'CHECK · MEDICAL' }));
      if (r.reviewed[sec.id]) lab.append(Object.assign(el('span', 'tag rev'), { textContent: '✓ REVIEWED' }));
      const body = el('td');
      body.append(sectionBody(r, sec));
      tr.append(lab, body);
      const holder = el('tbody');
      tb.append(tr);
      tr.onclick = () => { state.selSection = sec.id; renderDocument(); renderPanel(); };
      if (state.selSection === sec.id) { lab.style.background = 'var(--accent-tint)'; body.style.background = 'var(--accent-tint)'; }
      tr.id = `sec-${sec.id}`;
    }
    t.append(tb); page.append(t); page.append(docFooter(r));
    host.append(page);
  }
}

/* ================= right panel ================= */
function renderPanel() {
  const r = reportOf(state.activeReport);
  const panel = $('#panel');
  if (!panel || !r) return;
  panel.innerHTML = '';
  const secs = state.template.sections.filter((s) => s.on && s.id !== 'table');
  const done = secs.filter((s) => r.reviewed[s.id]).length;

  if (!state.selSection) {
    const pad = el('div', 'panel-pad');
    pad.append(Object.assign(el('h3'), { textContent: 'Sections', style: 'font-size:16px' }));
    pad.append(Object.assign(el('p'), { textContent: `${done} of ${secs.length} reviewed`, style: 'font-size:12.5px;color:var(--muted);margin:6px 0 0' }));
    const bar = el('div', 'rev-bar');
    const fill = el('i'); fill.style.width = `${(done / Math.max(secs.length, 1)) * 100}%`;
    bar.append(fill); pad.append(bar);
    const list = el('div', 'sec-list');
    for (const s of secs) {
      const b = el('button', 'sec-row');
      const dot = el('span', 'dot' + (r.reviewed[s.id] ? ' done' : r.flags[s.id] ? ' flag' : ''));
      b.append(dot, el('span', null, s.label));
      b.onclick = () => { state.selSection = s.id; renderDocument(); renderPanel(); scrollTo_(s.id); };
      list.append(b);
    }
    pad.append(list);
    panel.append(pad);
    return;
  }

  const sec = secs.find((s) => s.id === state.selSection) ?? state.template.sections.find((s) => s.id === state.selSection);
  if (!sec) { state.selSection = null; return renderPanel(); }

  const pad = el('div', 'panel-pad');
  const back = el('button', 'btn-ghost', '‹ All sections');
  back.style.padding = '0 0 10px';
  back.onclick = () => { state.selSection = null; renderDocument(); renderPanel(); };
  pad.append(back);
  pad.append(Object.assign(el('h3'), { textContent: sec.label, style: 'font-size:19px;line-height:1.2' }));
  pad.append(Object.assign(el('p'), { textContent: 'Click any text in the page to edit it.', style: 'font-size:12.5px;color:var(--muted);margin:8px 0 0' }));
  if (r.flags[sec.id]) {
    pad.append(Object.assign(el('div', 'privnote'), {
      textContent: 'This section mentions health or personal detail. Check it is appropriate for a family to read before marking it reviewed.',
    }));
  }

  const hist = r.history[sec.id] ?? [];
  if (hist.length) {
    pad.append(Object.assign(el('p', 'mono'), { textContent: 'Changes', style: 'margin:20px 0 8px' }));
    hist.slice(-5).reverse().forEach((h, idx) => {
      const d = el('div', 'chg');
      d.append(el('span', null, h.what));
      if (idx === 0 && r._undo?.sectionId === sec.id) {
        const u = el('button', 'btn-ghost', 'Undo');
        u.style.cssText = 'padding:0 0 0 8px;text-decoration:underline;font-size:12.5px';
        u.onclick = () => { r._undo.apply(); r._undo = null; hist.pop(); touch(r); renderDocument(); renderPanel(); };
        d.append(u);
      }
      pad.append(d);
    });
  }

  const sources = sourcesFor(r, sec.id);
  if (sources.length) {
    pad.append(Object.assign(el('p', 'mono'), { textContent: 'From the forms', style: 'margin:20px 0 8px' }));
    sources.slice(0, 8).forEach((s) => {
      const c = el('div', 'src');
      c.append(Object.assign(el('div', 'mono m'), { textContent: s.meta }));
      c.append(Object.assign(el('div', 't'), { textContent: s.text }));
      pad.append(c);
    });
  }
  panel.append(pad);

  const foot = el('div', 'panel-foot');
  const mark = el('button', r.reviewed[sec.id] ? 'btn-2' : 'btn', r.reviewed[sec.id] ? '✓ Reviewed' : 'Mark as reviewed');
  mark.style.flex = '1';
  mark.onclick = () => {
    r.reviewed[sec.id] = !r.reviewed[sec.id];
    const all = secs.every((s) => r.reviewed[s.id]);
    if (all && r.status === 'Draft') r.status = 'Ready';
    if (!all && r.status === 'Ready') r.status = 'Draft';
    touch(r); renderDocument(); renderPanel(); renderTop();
  };
  const next = el('button', 'btn-2', 'Next ›');
  next.onclick = () => {
    const i = secs.findIndex((s) => s.id === sec.id);
    const after = [...secs.slice(i + 1), ...secs.slice(0, i)];
    const target = after.find((s) => !r.reviewed[s.id]) ?? after[0];
    if (target) { state.selSection = target.id; renderDocument(); renderPanel(); scrollTo_(target.id); }
  };
  foot.append(mark, next);
  panel.append(foot);
}

function scrollTo_(id) {
  const n = document.getElementById(`sec-${id}`);
  n?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* Which tutor answers fed this section — shown as source cards. */
function sourcesFor(r, id) {
  const field = { successes: 'generalComments', comms: 'generalComments', semh: 'concerns',
    sensory: 'generalComments', challenges: 'concerns', targets: 'keyActions',
    cognition: 'generalComments', overview: 'generalComments', attendance: null }[id];
  const q = { generalComments: 'Q10', concerns: 'Q8', keyActions: 'Q9' }[field];
  if (!field) {
    return r.term.attendance.summary.map((w) => ({
      meta: `Q5 · w/b ${fmtWeek(w.weekBeginning)}`,
      text: `${ATTW[w.attendance]}${w.punctuality ? ` · punctuality ${w.punctuality}` : ''}`,
    }));
  }
  return r.term.submissions
    .filter((s) => (s[field] ?? '').trim())
    .sort((a, b) => a.weekBeginning.localeCompare(b.weekBeginning))
    .map((s) => ({
      meta: `${q} · ${s.subject} · w/b ${fmtWeek(s.weekBeginning)}${s.instructorName ? ` · ${s.instructorName}` : ''}`,
      text: s[field],
    }));
}

/* ================= template editor ================= */
function screenTemplate() {
  const t = state.template;
  const wrap = el('div', 'col');
  wrap.style.maxWidth = '1080px';
  wrap.append(Object.assign(el('p', 'mono eyebrow'), { textContent: 'Report template' }));
  wrap.append(Object.assign(el('h1', 'display'), { textContent: 'How every report should look.' }));
  wrap.append(Object.assign(el('p', 'lede'), { textContent: 'These settings apply to every report you generate from now on. Reports already written keep what they have.' }));

  const cols = el('div', 'tpl-wrap');
  cols.style.marginTop = '28px';
  const main = el('div', 'tpl-main');

  /* logo + header + footer */
  const b1 = el('div', 'block');
  b1.append(el('h3', null, 'Logo, header and footer'));
  b1.append(Object.assign(el('p', 'hint'), { textContent: 'Used on every page of every report.' }));
  const logoRow = el('div');
  logoRow.style.cssText = 'display:flex;align-items:center;gap:14px;margin-bottom:16px;flex-wrap:wrap';
  const lp = el('img'); lp.src = t.logo || 'smk-logo.png'; lp.alt = 'Logo';
  lp.style.cssText = 'height:40px;mix-blend-mode:multiply';
  const rep = el('button', 'btn-2', 'Replace logo');
  rep.onclick = () => { logoTarget = 'template'; $('#logo-input').click(); };
  const rst = el('button', 'btn-ghost', 'Reset');
  rst.onclick = () => { t.logo = null; save(); render(); };
  const posSel = el('select');
  posSel.style.cssText = 'height:36px;border:1px solid var(--border);border-radius:8px;padding:0 8px';
  for (const p of ['left', 'center', 'right']) {
    const o = el('option', null, p[0].toUpperCase() + p.slice(1)); o.value = p;
    if (t.logoPos === p) o.selected = true; posSel.append(o);
  }
  posSel.onchange = () => { t.logoPos = posSel.value; save(); render(); };
  const sz = el('input'); sz.type = 'range'; sz.min = '70'; sz.max = '260'; sz.value = t.logoSize;
  sz.oninput = () => { t.logoSize = +sz.value; save(); renderDocument(); renderMini(); };
  logoRow.append(lp, rep, rst, posSel, sz);
  b1.append(logoRow);

  const fg = el('div', 'grid3');
  const tf = (label, obj, key) => {
    const l = el('label', 'f'); l.append(el('span', null, label));
    const i = el('input'); i.value = obj[key] ?? '';
    i.oninput = () => { obj[key] = i.value; save(); renderMini(); };
    l.append(i); return l;
  };
  fg.append(tf('Report title', t.header, 'title'), tf('Reporting date line', t.header, 'date'),
    tf('Student label', t.header, 'studentLabel'), tf('Year label', t.header, 'yearLabel'),
    tf('Academic year label', t.header, 'academicLabel'), tf('Term label', t.header, 'termLabel'),
    tf('Footer address', t.footer, 'addr'), tf('Footer phone', t.footer, 'phone'),
    tf('Footer email', t.footer, 'email'), tf('Footer legal line', t.footer, 'legal'));
  b1.append(fg);
  main.append(b1);

  /* house style */
  const b2 = el('div', 'block');
  b2.append(el('h3', null, 'How it should read'));
  b2.append(Object.assign(el('p', 'hint'), { textContent: 'Guidance given to the writer for every section.' }));
  const ta = el('textarea', 'ta'); ta.value = t.guidance;
  ta.oninput = () => { t.guidance = ta.value; save(); };
  b2.append(ta);
  main.append(b2);

  /* sections */
  const b3 = el('div', 'block');
  b3.append(el('h3', null, 'Sections'));
  b3.append(Object.assign(el('p', 'hint'), { textContent: 'Drag to reorder, or use the arrows. Overview and the subject table are fixed to pages 1 and 2.' }));
  const list = el('div');
  t.sections.forEach((s, i) => {
    const row = el('div', 'srow2');
    row.draggable = !s.pinned;
    row.dataset.i = i;
    if (!s.pinned) {
      row.addEventListener('dragstart', (e) => { dragFrom = i; row.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragend', () => { row.classList.remove('drag'); list.querySelectorAll('.srow2').forEach((n) => n.classList.remove('over')); });
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('over'); });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragFrom == null || dragFrom === i) return;
        const moved = t.sections.splice(dragFrom, 1)[0];
        t.sections.splice(i, 0, moved);
        dragFrom = null; save(); render();
      });
    }
    row.append(Object.assign(el('span', 'handle'), { textContent: s.pinned ? '•' : '⠿' }));
    row.append(el('span', 'n', String(i + 1)));
    const lb = el('span', 'lb', s.label);
    row.append(lb);
    row.append(Object.assign(el('span', 'src2'), { textContent: s.source }));
    if (!s.pinned) {
      const up = el('button', 'btn-ghost', '▲'); up.style.padding = '2px 5px';
      up.disabled = i <= 2;
      up.onclick = (e) => { e.stopPropagation(); if (i > 2) { const m = t.sections.splice(i, 1)[0]; t.sections.splice(i - 1, 0, m); save(); render(); } };
      const dn = el('button', 'btn-ghost', '▼'); dn.style.padding = '2px 5px';
      dn.disabled = i >= t.sections.length - 1;
      dn.onclick = (e) => { e.stopPropagation(); if (i < t.sections.length - 1) { const m = t.sections.splice(i, 1)[0]; t.sections.splice(i + 1, 0, m); save(); render(); } };
      row.append(up, dn);
    }
    const tg = el('button', 'toggle');
    tg.setAttribute('aria-pressed', String(!!s.on));
    tg.setAttribute('aria-label', `${s.label} on or off`);
    tg.append(el('i'));
    tg.disabled = !!s.pinned;
    tg.onclick = (e) => { e.stopPropagation(); s.on = !s.on; save(); render(); };
    row.append(tg);
    row.onclick = () => { expanded = expanded === s.id ? null : s.id; render(); };
    list.append(row);

    if (expanded === s.id) {
      const ex = el('div');
      ex.style.cssText = 'padding:12px 14px;border:1px solid var(--border);border-top:0;border-radius:0 0 9px 9px;margin:-7px 0 8px;background:var(--surface);display:grid;gap:10px';
      const mk = (label, val, on) => {
        const l = el('label', 'f'); l.append(el('span', null, label));
        const i = el('input'); i.value = val;
        i.onclick = (e) => e.stopPropagation();
        i.oninput = () => { on(i.value); save(); };
        l.append(i); return l;
      };
      ex.append(mk('Label', s.label, (v) => { s.label = v; lb.textContent = v; }));
      ex.append(mk('Comes from', s.source, (v) => { s.source = v; }));
      const l3 = el('label', 'f'); l3.append(el('span', null, 'Instructions for this section'));
      const t3 = el('textarea', 'ta'); t3.value = s.instr; t3.style.minHeight = '60px';
      t3.onclick = (e) => e.stopPropagation();
      t3.oninput = () => { s.instr = t3.value; save(); };
      l3.append(t3); ex.append(l3);
      ex.onclick = (e) => e.stopPropagation();
      list.append(ex);
    }
  });
  b3.append(list);
  const add = el('button', 'btn-2', '+ Add section');
  add.style.marginTop = '8px';
  add.onclick = () => {
    t.sections.push({ id: uid(), label: 'NEW SECTION', source: 'Q10 general comments', instr: '2–3 sentences.', on: true });
    save(); render();
  };
  b3.append(add);
  main.append(b3);

  /* preview */
  const side = el('div', 'tpl-side');
  side.append(Object.assign(el('p', 'mono'), { textContent: 'Page preview', style: 'margin-bottom:10px' }));
  const mini = el('div', 'mini-grid'); mini.id = 'mini';
  side.append(mini);
  cols.append(main, side);
  wrap.append(cols);
  setTimeout(renderMini, 0);
  return wrap;
}

let expanded = null, dragFrom = null, logoTarget = 'report';

function renderMini() {
  const host = $('#mini');
  if (!host) return;
  const t = state.template;
  host.innerHTML = '';
  const on = t.sections.filter((s) => s.on);
  const rest = on.filter((s) => s.id !== 'overview' && s.id !== 'table');
  const pages = [['OVERVIEW'], ['SUBJECT TABLE']];
  for (let i = 0; i < rest.length; i += 2) pages.push(rest.slice(i, i + 2).map((s) => s.label));
  for (const labels of pages) {
    const p = el('div', 'mini');
    for (const l of labels) {
      p.append(Object.assign(el('b'), { textContent: l }));
      for (let k = 0; k < 4; k++) {
        const i = el('i'); i.style.width = `${60 + Math.random() * 38}%`; p.append(i);
      }
      p.append(Object.assign(el('div'), { style: 'height:5px' }));
    }
    host.append(p);
  }
}

/* ================= project screen ================= */
function screenProject() {
  const p = projectOf(state.activeProject);
  const wrap = el('div', 'col');
  if (!p) { wrap.append(el('p', null, 'That project no longer exists.')); return wrap; }
  const h = el('h1', 'display');
  const nameInput = el('input');
  nameInput.value = p.name;
  nameInput.style.cssText = 'font:inherit;border:0;background:none;width:100%;padding:0;outline:none';
  nameInput.onchange = () => { p.name = nameInput.value.trim() || 'Untitled project'; save(); render(); };
  h.append(nameInput);
  wrap.append(h);
  const rs = reportsIn(p.id);
  wrap.append(Object.assign(el('p', 'lede'), { textContent: `${rs.length} report${rs.length === 1 ? '' : 's'}` }));

  const bar = el('div');
  bar.style.cssText = 'display:flex;gap:10px;margin-top:20px;flex-wrap:wrap';
  const nb = el('button', 'btn', 'New report in this project');
  nb.onclick = () => { state.upload = null; state.screen = 'upload'; render(); };
  const db = el('button', 'btn-2 btn-danger', 'Delete project');
  db.onclick = () => deleteProject(p.id);
  bar.append(nb, db);
  wrap.append(bar);

  if (!rs.length) {
    wrap.append(Object.assign(el('div', 'empty-box'), { textContent: 'No reports here yet' }));
    return wrap;
  }
  const t = el('table', 'pt');
  t.innerHTML = '<thead><tr><th>Student</th><th>Year</th><th>Updated</th><th>Status</th><th></th></tr></thead>';
  const tb = el('tbody');
  for (const r of rs.sort((a, b) => b.updatedAt - a.updatedAt)) {
    const tr = el('tr');
    const a = el('td');
    const link = el('button', 'btn-ghost', r.student);
    link.style.cssText = 'padding:0;text-align:left;color:var(--ink)';
    link.onclick = () => { state.activeReport = r.id; state.selSection = null; state.screen = 'report'; render(); };
    a.append(link);
    tr.append(a, el('td', null, r.keyStage || '—'),
      el('td', null, new Date(r.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })));
    const st = el('td');
    st.append(Object.assign(el('span', `status ${r.status.toLowerCase()}`), { textContent: r.status }));
    tr.append(st);
    const x = el('td');
    const xb = el('button', 'xbtn', '×');
    xb.setAttribute('aria-label', `Delete ${r.student}'s report`);
    xb.onclick = () => deleteReport(r.id);
    x.append(xb); tr.append(x);
    tb.append(tr);
  }
  t.append(tb); wrap.append(t);
  return wrap;
}

/* ================= share & export ================= */
function reportHtml(r, forWord) {
  const host = $('#docscroll').cloneNode(true);
  host.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
  host.querySelectorAll('.tag').forEach((n) => n.remove());
  host.querySelectorAll('.dsec').forEach((n) => { n.className = 'dsec'; n.removeAttribute('style'); });
  host.querySelectorAll('td').forEach((n) => { if (n.style.background) n.style.background = ''; });
  const css = `
    body{margin:0;background:#fff;font-family:Carlito,Calibri,sans-serif;color:#111}
    .sheet{width:${forWord ? '100%' : '720px'};margin:0 auto;padding:36px 40px 64px;position:relative;
      font-size:13px;line-height:1.45;${forWord ? '' : 'page-break-after:always;'}}
    .sheet:last-child{page-break-after:auto}
    .dlogo{height:52px;display:block;margin-bottom:18px}
    .dtitle{text-align:center;font-weight:700;font-size:13px}.dtitle div+div{margin-top:7px}
    .dmeta{margin:26px 0 30px;font-weight:700;font-size:12.5px}.dmeta div+div{margin-top:7px}
    .dlabel{font-weight:700;font-size:12.5px;margin-bottom:8px}
    .dtable,.dl{width:100%;border-collapse:collapse}
    .dtable th,.dtable td{border:.75px solid #111;padding:6px;vertical-align:top;text-align:left;font-size:9.5px}
    .dtable th{font-weight:700}
    .dl td{border:.75px solid #111;padding:9px 11px;vertical-align:top;font-size:11.5px}
    .dl td.lab{width:168px;font-weight:700;text-transform:uppercase}
    .dl p{margin:0 0 8px} .dl ul{margin:4px 0 8px;padding-left:17px}
    .dsub{font-weight:700;margin:8px 0 3px}
    .dfoot{${forWord ? '' : 'position:absolute;left:40px;right:40px;bottom:16px;'}margin-top:26px;font-size:9.5px;color:#2F4A7A}
    .dfoot-row{display:flex;justify-content:space-between;gap:10px}
    .dfoot i{color:#D2232A;font-style:normal}.dlegal{text-align:center;margin-top:4px}
    @page{size:A4;margin:${forWord ? '1.6cm' : '0'}}`;
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(r.student)} — Termly report</title>
<link href="https://fonts.googleapis.com/css2?family=Carlito:wght@400;700&display=swap" rel="stylesheet">
<style>${css}</style></head><body>${host.innerHTML}</body></html>`;
}

function shareModal() {
  const r = reportOf(state.activeReport);
  if (!r) return;
  const secs = state.template.sections.filter((s) => s.on && s.id !== 'table');
  const done = secs.filter((s) => r.reviewed[s.id]).length;
  const ready = done === secs.length;

  const scrim = el('div', 'scrim');
  const m = el('div', 'modal');
  m.append(el('h2', null, 'Share & export'));
  m.append(Object.assign(el('p'), { textContent: `${r.student} — Termly report`, style: 'color:var(--muted);font-size:13.5px;margin:4px 0 20px' }));

  m.append(Object.assign(el('h3'), { textContent: 'Ask a colleague to read it', style: 'font-size:14px;margin-bottom:8px' }));
  const row = el('div'); row.style.cssText = 'display:flex;gap:8px';
  const inp = el('input');
  inp.placeholder = 'Name or work email';
  inp.style.cssText = 'flex:1;height:38px;border:1px solid var(--border);border-radius:8px;padding:0 11px';
  const sh = el('button', 'btn-2', 'Share');
  sh.onclick = () => {
    if (!inp.value.trim()) return;
    sh.textContent = 'Sent ✓'; sh.disabled = true;
    toast(`Shared with ${inp.value.trim()} — they can read and comment, only you can approve.`);
  };
  row.append(inp, sh); m.append(row);
  m.append(Object.assign(el('p'), { textContent: 'They can read and comment. Only you can approve and export.', style: 'font-size:12px;color:var(--faint);margin:8px 0 22px' }));

  m.append(Object.assign(el('h3'), { textContent: 'Download for the family', style: 'font-size:14px;margin-bottom:4px' }));
  if (!ready) {
    m.append(Object.assign(el('div', 'privnote'), {
      textContent: `${done} of ${secs.length} sections reviewed. Review the rest before downloading — these reports go to families.`,
    }));
  }
  const grid = el('div', 'dl-grid');
  const tile = (title, sub, run) => {
    const b = el('button', 'dl-tile');
    b.disabled = !ready;
    b.append(Object.assign(el('b'), { textContent: title }), Object.assign(el('span'), { textContent: sub }));
    b.onclick = async () => {
      b.querySelector('b').textContent = 'Preparing…';
      try { await run(); b.querySelector('b').textContent = 'Downloaded ✓'; }
      catch (e) { b.querySelector('b').textContent = title; toast(e?.message || 'Could not download.'); }
    };
    return b;
  };
  const stem = `${r.student.split(/\s+/).reverse().join('_')}_${(r.termLabel || 'Term').split(' ')[0]}`;
  grid.append(
    tile('Word (.doc)', 'Opens in Word, keeps the layout', async () => {
      if (!downloads) throw new Error('Downloads are unavailable in this view.');
      await downloads.save({ filename: `${stem}.doc`, data: reportHtml(r, true) });
      r.status = 'Shared'; touch(r); renderTop();
      toast(`${stem}.doc`);
    }),
    tile('PDF', 'Opens ready to print or save as PDF', async () => {
      if (!downloads) throw new Error('Downloads are unavailable in this view.');
      const html = reportHtml(r, false).replace('</body>',
        '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},400)})<\/script></body>');
      await downloads.save({ filename: `${stem}.html`, data: html });
      r.status = 'Shared'; touch(r); renderTop();
      toast(`${stem}.html — open it and save as PDF`);
    }),
  );
  m.append(grid);

  const close = el('button', 'btn-ghost', 'Close');
  close.style.marginTop = '18px';
  close.onclick = closeOverlay;
  m.append(close);
  scrim.append(m);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) closeOverlay(); });
  $('#overlay').append(scrim);
}

/* ================= file handling ================= */
function recomputeUpload() {
  const u = state.upload;
  if (!u) return;
  const good = u.files.filter((f) => f.ok);
  u.failed = u.files.filter((f) => f.error).length;
  const all = good.flatMap((f) => f.submissions);
  if (!all.length) { u.term = null; u.multiStudent = 0; return; }
  const byId = new Map();
  for (const s of all) byId.set(s.id, s);
  const terms = E.aggregateSubmissions([...byId.values()]);
  u.multiStudent = terms.length > 1 ? terms.length : 0;
  const pick = u.student
    ? terms.find((t) => t.studentName.toLowerCase() === u.student.toLowerCase()) ?? terms[0]
    : terms[0];
  u.term = pick;
  if (!u.student) u.student = pick.studentName;
}

async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  state.upload ||= { files: [], student: '', keyStage: '', projectId: ensureProject(), term: null, failed: 0 };
  const u = state.upload;
  if (!u.projectId || !projectOf(u.projectId)) u.projectId = ensureProject();

  const entries = files.map((f) => ({ name: f.name, size: f.size, status: 'reading', ok: false, submissions: [], error: null, detail: '' }));
  u.files.push(...entries);
  render();

  for (let i = 0; i < files.length; i++) {
    const slot = entries[i];
    const res = await readOne(files[i], (m) => { slot.detail = m; render(); });
    Object.assign(slot, res, { status: 'done' });
    recomputeUpload();
    render();
  }
}

async function loadSample() {
  state.upload ||= { files: [], student: '', keyStage: 'KS 4', projectId: ensureProject(), term: null, failed: 0 };
  const slot = { name: 'George Holmes — Spring 2026 forms.xlsx', size: 18000, status: 'reading', ok: false, submissions: [], error: null, detail: 'Loading sample…' };
  state.upload.files.push(slot);
  render();
  const subs = E.sampleSubmissions();
  Object.assign(slot, {
    status: 'done', ok: true, submissions: subs,
    detail: `${subs.length} responses · ${[...new Set(subs.map((s) => s.subject))].join(', ')}`,
  });
  state.upload.student = 'George Holmes';
  state.upload.keyStage = 'KS 4';
  recomputeUpload();
  render();
}

/* ================= render ================= */
function render() {
  ensureProject();
  renderSidebar();
  renderTop();
  const host = $('#screen');
  host.innerHTML = '';
  if (state.screen === 'report' && !reportOf(state.activeReport)) state.screen = 'upload';

  if (state.screen === 'report') {
    const w = el('div', 'report-wrap');
    const d = el('div'); d.id = 'docscroll';
    const p = el('aside'); p.id = 'panel';
    w.append(d, p);
    host.style.overflow = 'hidden';
    host.append(w);
    renderDocument();
    renderPanel();
    const r = reportOf(state.activeReport);
    if (r?.provenance && !r._shown) {
      r._shown = true;
      setTimeout(() => toast(r.provenance), 300);
    }
    return;
  }
  host.style.overflow = 'auto';
  host.append(
    state.screen === 'generating' ? screenGenerating()
    : state.screen === 'template' ? screenTemplate()
    : state.screen === 'project' ? screenProject()
    : screenUpload(),
  );
}

/* ================= wiring ================= */
$('#nav-new').onclick = () => { state.upload = null; state.screen = 'upload'; render(); };
$('#nav-tpl').onclick = () => { state.screen = 'template'; render(); };
$('#new-proj').onclick = () => {
  const p = { id: uid(), name: 'Untitled project' };
  state.projects.push(p);
  state.activeProject = p.id;
  state.screen = 'project';
  save(); render();
};
$('#search').oninput = (e) => { state.search = e.target.value; renderSidebar(); };
$('#acct').onclick = (e) => popMenu(e.currentTarget, [
  { label: 'Report template', run: () => { state.screen = 'template'; render(); } },
  { label: 'Sign out', run: () => toast('Sign-out needs the real build — this demo has no accounts yet.') },
]);
$('#file-input').onchange = (e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; };
$('#logo-input').onchange = (e) => {
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) return toast('That image is over 2 MB — use a smaller one.');
  const rd = new FileReader();
  rd.onload = () => {
    state.template.logo = rd.result;
    if (logoTarget === 'report') { const r = reportOf(state.activeReport); if (r) r.logo = rd.result; }
    save(); render();
    toast('Logo replaced on every page.');
  };
  rd.readAsDataURL(f);
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(); });

load();
ensureProject();
if (state.reports.length) { state.activeReport = state.reports[0].id; state.screen = 'report'; }
render();
