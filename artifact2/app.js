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
    logo: null, logoPos: 'left', logoSize: 140, logoX: 0, logoY: 0,
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
  screen: 'upload', activeProject: null, activeReport: null, showArchived: false,
  expandedProjects: {},
  selSection: null, search: '', upload: null, gen: null,
};

function save() {
  try {
    localStorage.setItem(LS, JSON.stringify({
      projects: state.projects, reports: state.reports, template: state.template,
      user: state.user, expandedProjects: state.expandedProjects,
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
    if (d.expandedProjects) state.expandedProjects = d.expandedProjects;
  } catch { /* corrupt store: start fresh rather than crash */ }
}

/** Projects exist only when someone makes one. A report sits loose in Recents
 *  until it is explicitly filed, so nothing is hidden in a folder nobody created. */
function ensureProject() {
  const active = projectOf(state.activeProject);
  if (!active || active.archived) {
    state.activeProject = state.projects.find((p) => !p.archived)?.id ?? null;
  }
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
  if (!sample) throw new Error('PDF, Word and image files cannot be read in this view. Upload the Microsoft Forms .xlsx or .csv export instead.');
  const isImg = /\.(png|jpe?g|gif|webp)$/i.test(file.name);
  let result;
  if (isImg) {
    const lim = await sample.limits().catch(() => ({}));
    if (!lim.images) throw new Error('Images cannot be read in this view. Try a PDF, Word file or the Forms export.');
    onProgress?.('Reading the image…');
    result = await sample.json(EXTRACT + '(see attached image)', { images: [file], modelTier: 'complex' });
  } else {
    const text = await documentText(file);
    if (!text.trim()) throw new Error('No readable text. If this is a scanned PDF, upload it as an image instead.');
    onProgress?.('Reading the document…');
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

const STEPS = (files, sections, students) => ([
  `Reading ${files} file${files === 1 ? '' : 's'}`,
  'Working out the subject table',
  'Checking comments for private details',
  students > 1
    ? `Drafting ${sections} sections for ${students} students`
    : `Drafting ${sections} sections with your template`,
  'Matching your example report',
]);

/** Builds one report. Returns it without touching global state. */
async function buildReport(term, row, projectId, tpl) {
  const fallback = E.generateFromTemplate(term);
  let content = fallback, templated = true;

  if (sample) {
    try {
      const { term: masked, pseudonym } = E.pseudonymise(term);
      const raw = await sample.json(promptFor(masked, tpl, tpl.sections), { modelTier: 'complex' });
      content = coerce(E.rehydrate(raw, pseudonym), term, fallback);
      templated = false;
    } catch { /* fall through to the offline draft */ }
  }

  const named = row.name.trim() !== term.studentName
    ? { ...term, studentName: row.name.trim() }
    : term;
  const blocks = contentToBlocks(content, named);

  return {
    id: uid(), projectId, student: row.name.trim(), keyStage: row.keyStage || '',
    status: 'Draft', updatedAt: Date.now(), createdAt: Date.now(),
    pinned: false, archived: false, unread: false,
    term: named, blocks, flags: flagSections(blocks, named), reviewed: {}, history: {},
    matrix: E.buildMatrix(named, { tiers: {}, averageGrades: {} }, content),
    header: { ...tpl.header }, footer: { ...tpl.footer }, logo: tpl.logo,
    templated,
  };
}

async function runBatch(jobs, meta) {
  if (runBatch.busy) return;
  runBatch.busy = true;
  const tpl = state.template;
  const enabled = tpl.sections.filter((x) => x.on && x.id !== 'table');

  state.gen = {
    steps: STEPS(state.upload?.files?.length ?? 1, enabled.length, jobs.length),
    at: 0, done: false, total: jobs.length, made: 0,
    title: jobs.length > 1
      ? `Writing ${jobs.length} reports…`
      : `Writing ${jobs[0].row.name.trim().split(/\s+/)[0]}'s report…`,
  };
  render();

  const tick = async (i, ms = 400) => { state.gen.at = i; render(); await new Promise((r) => setTimeout(r, ms)); };
  await tick(0, 280);
  await tick(1, 340);
  await tick(2, 300);
  state.gen.at = 3; render();

  const made = [];
  for (const job of jobs) {
    state.gen.current = job.row.name.trim();
    render();
    made.push(await buildReport(job.term, job.row, meta.projectId, tpl));
    state.gen.made = made.length;
    render();
  }

  await tick(4, 300);
  state.gen.done = true;
  state.gen.title = jobs.length > 1 ? `${jobs.length} drafts are ready.` : 'The draft is ready.';
  render();
  await new Promise((r) => setTimeout(r, 450));

  // Newest first in Recents, but open the first student the user listed.
  for (const r of [...made].reverse()) state.reports.unshift(r);
  if (meta.projectId) state.expandedProjects[meta.projectId] = true;
  state.activeReport = made[0].id;
  state.selSection = null;
  state.gen = null;
  state.upload = null;
  state.screen = 'report';
  runBatch.busy = false;
  save(); render();
  if (made.length > 1) toast(`${made.length} drafts created. Review each one before exporting.`);
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

function popMenu(anchor, items, opts = {}) {
  if (!opts.nested) closeOverlay();
  const r = anchor.getBoundingClientRect();
  const m = el('div', 'menu');
  m.style.left = `${Math.min(opts.nested ? r.right + 4 : r.left, innerWidth - 190)}px`;
  m.style.top = `${Math.min(opts.nested ? r.top : r.bottom + 4, innerHeight - 40 - items.length * 32)}px`;
  for (const it of items) {
    if (it.divider) { m.append(el('div', 'menu-div')); continue; }
    const b = el('button', it.danger ? 'btn-danger' : null);
    b.append(el('span', null, it.label));
    if (it.items) b.append(Object.assign(el('span', 'chev'), { textContent: '›' }));
    if (it.check) b.append(Object.assign(el('span', 'chev'), { textContent: '✓' }));
    if (it.items) {
      b.onclick = (e) => { e.stopPropagation(); m.querySelectorAll('.menu').forEach((n) => n.remove()); popMenu(b, it.items, { nested: true }); };
    } else {
      b.onclick = (e) => { e.stopPropagation(); closeOverlay(); it.run(); };
    }
    m.append(b);
  }
  $('#overlay').append(m);
  if (!opts.nested) setTimeout(() => document.addEventListener('click', closeOverlay, { once: true }), 0);
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


/* ---- icons ---- */
function svg(paths, cls) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  n.setAttribute('viewBox', '0 0 16 16');
  n.setAttribute('fill', 'none');
  n.setAttribute('aria-hidden', 'true');
  if (cls) n.setAttribute('class', cls);
  n.innerHTML = paths;
  return n;
}
const ICON = {
  chevron: () => svg('<path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
  folder: () => svg('<path d="M1.75 4.25a1 1 0 0 1 1-1h3.1a1 1 0 0 1 .78.37l.74.92a1 1 0 0 0 .78.37h4.1a1 1 0 0 1 1 1v6.47a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1V4.25Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>', 'ic'),
  folderOpen: () => svg('<path d="M1.75 12.4V4.25a1 1 0 0 1 1-1h3.1a1 1 0 0 1 .78.37l.74.92a1 1 0 0 0 .78.37h4.1a1 1 0 0 1 1 1v1.04" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M1.75 12.4l1.6-5.1a1 1 0 0 1 .96-.7h10.2a.6.6 0 0 1 .57.78l-1.5 4.8a1 1 0 0 1-.96.7H2.75a1 1 0 0 1-1-.48Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>', 'ic'),
  doc: () => svg('<path d="M4 1.75h4.6L12.25 5.4v8.85a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8.4 1.9V5.5h3.6" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.6 8.6h4.2M5.6 11h2.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>', 'ic'),
  template: () => svg('<rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M2.25 6.1h11.5M6.1 6.1v7.15" stroke="currentColor" stroke-width="1.2"/>', 'ic'),
};

/** One report row in the sidebar — used both under a project and in Recents. */
function reportRow(r, { dimmed = false, nested = false } = {}) {
  const on = state.screen === 'report' && state.activeReport === r.id;
  const b = el('button', 'side-item' + (on ? ' on' : '') + (dimmed ? ' dim-row' : '') + (nested ? ' nested' : ''));
  if (nested) b.append(ICON.doc());
  const lines = nested ? el('span', 'lines') : b;
  const l1 = el('span', 'l1');
  if (r.unread) l1.append(el('span', 'unread-dot'));
  if (r.pinned && !nested) l1.append(Object.assign(el('span', 'pin-ic'), { textContent: '📌' }));
  l1.append(document.createTextNode(nested ? r.student : `${r.student} — Termly report`));
  if (r.unread) l1.style.fontWeight = '600';
  // Just the name, as in the Claude web app. The project is obvious from where the
  // row sits, and "Draft" repeats what the report screen already says.
  lines.append(l1);
  if (nested) b.append(lines);
  b.onclick = () => {
    state.activeReport = r.id; state.selSection = null; state.screen = 'report';
    r.unread = false; save(); render();
  };
  const d = el('button', 'dots', '⋯');
  d.setAttribute('aria-label', `Options for ${r.student}'s report`);
  d.onclick = (e) => {
    e.stopPropagation();
    const others = state.projects.filter((p) => !p.archived);
    popMenu(d, [
      { label: r.pinned ? 'Unpin' : 'Pin', check: !!r.pinned, run: () => toggleFlag(r, 'pinned', [`Pinned ${r.student}`, `Unpinned ${r.student}`]) },
      { label: 'Rename', run: () => renameReport(r.id, b) },
      { label: 'Move to project', items: others.map((proj) => ({
          label: proj.name + (proj.id === r.projectId ? '  ·  current' : ''),
          run: () => { if (proj.id !== r.projectId) moveReport(r.id, proj.id); },
        })).concat([{ divider: true }, { label: '+ New project…', run: () => {
          const proj = { id: uid(), name: 'Untitled project' };
          state.projects.push(proj); moveReport(r.id, proj.id);
          requestAnimationFrame(() => {
            const row = [...document.querySelectorAll('#projects > .side-item')]
              .find((n) => n.querySelector('.l1')?.textContent.trim().startsWith('Untitled project'));
            if (row) renameProject(proj.id, row);
          });
        } }]) },
      { label: r.unread ? 'Mark as read' : 'Mark as unread', run: () => toggleFlag(r, 'unread', ['Marked unread', 'Marked read']) },
      { divider: true },
      { label: r.archived ? 'Unarchive' : 'Archive', run: () => archiveReport(r.id) },
      { label: 'Delete', danger: true, run: () => deleteReport(r.id) },
    ]);
  };
  b.append(d);
  return b;
}

function renderSidebar() {
  $('#acct-name').textContent = state.user.name;
  $('#acct-ini').textContent = initials(state.user.name);

  /* ---- projects: pinned first, archived tucked away ---- */
  const pc = $('#projects'); pc.innerHTML = '';
  const live = state.projects.filter((p) => !p.archived);
  const ordered = [...live.filter((p) => p.pinned), ...live.filter((p) => !p.pinned)];

  for (const proj of ordered) {
    const on = state.screen === 'project' && state.activeProject === proj.id;
    const kids = reportsIn(proj.id).filter((r) => !r.archived)
      .sort((a, b2) => b2.updatedAt - a.updatedAt);
    const open = !!state.expandedProjects[proj.id];

    const b = el('button', 'side-item has-chev' + (on ? ' on' : ''));
    b.setAttribute('aria-expanded', String(open));
    const chev = el('span', 'chev-btn' + (open ? ' open' : ''));
    chev.append(ICON.chevron());
    const toggle = () => {
      if (state.expandedProjects[proj.id]) delete state.expandedProjects[proj.id];
      else state.expandedProjects[proj.id] = true;
      save(); renderSidebar();
    };

    const l1 = el('span', 'l1');
    if (proj.pinned) l1.append(Object.assign(el('span', 'pin-ic'), { textContent: '📌' }));
    l1.append(document.createTextNode(proj.name));
    b.append(chev, open ? ICON.folderOpen() : ICON.folder(), l1);
    // Clicking the folder opens and closes it, as in the Claude web app.
    // "Open project" in the ⋯ menu is how you reach the project page.
    b.onclick = toggle;
    b.title = open ? `Collapse ${proj.name}` : `Expand ${proj.name}`;
    const d = el('button', 'dots', '⋯');
    d.setAttribute('aria-label', `Options for ${proj.name}`);
    d.onclick = (e) => {
      e.stopPropagation();
      popMenu(d, [
        { label: 'Open project', run: () => { state.activeProject = proj.id; state.screen = 'project'; render(); } },
        { label: open ? 'Collapse' : 'Expand', run: toggle },
        { label: proj.pinned ? 'Unpin' : 'Pin', check: !!proj.pinned, run: () => toggleFlag(proj, 'pinned', [`Pinned “${proj.name}”`, `Unpinned “${proj.name}”`]) },
        { label: 'Rename', run: () => renameProject(proj.id, b) },
        { label: 'New report here', run: () => {
            state.activeProject = proj.id; state.screen = 'upload';
            state.upload = { files: [], terms: [], rows: [], projectId: proj.id, failed: 0 };
            render();
          } },
        { divider: true },
        { label: 'Archive', run: () => archiveProject(proj.id) },
        { label: 'Delete', danger: true, run: () => deleteProject(proj.id) },
      ]);
    };
    b.append(d); pc.append(b);

    if (open) {
      const nest = el('div', 'nest');
      if (!kids.length) {
        nest.append(Object.assign(el('div', 'nest-empty'), { textContent: 'No reports yet' }));
      }
      for (const r of kids) nest.append(reportRow(r, { nested: true }));
      pc.append(nest);
    }
  }

  if (!ordered.length && !state.projects.length) {
    pc.append(Object.assign(el('div', 'nest-empty'), {
      textContent: 'No projects yet — use + to make one',
    }));
  }

  const archivedProjects = state.projects.filter((p) => p.archived);
  if (archivedProjects.length) {
    const h = el('div', 'side-head');
    const tog = el('button', 'arch-tog', `${state.showArchived ? '▾' : '▸'} Archived (${archivedProjects.length + state.reports.filter((r) => r.archived).length})`);
    tog.onclick = () => { state.showArchived = !state.showArchived; renderSidebar(); };
    h.append(tog); pc.append(h);
    if (state.showArchived) {
      for (const proj of archivedProjects) {
        const b = el('button', 'side-item dim-row');
        b.append(Object.assign(el('span', 'l1'), { textContent: `▸ ${proj.name}` }));
        b.onclick = () => { state.activeProject = proj.id; state.screen = 'project'; render(); };
        const d = el('button', 'dots', '⋯');
        d.onclick = (e) => {
          e.stopPropagation();
          popMenu(d, [
            { label: 'Unarchive', run: () => toggleFlag(proj, 'archived', ['', `Restored “${proj.name}”`]) },
            { label: 'Delete', danger: true, run: () => deleteProject(proj.id) },
          ]);
        };
        b.append(d); pc.append(b);
      }
    }
  }

  /* ---- recents ---- */
  const q = state.search.trim().toLowerCase();
  const all = state.reports
    .filter((r) => !q || r.student.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const visible = all.filter((r) => !r.archived);
  const archivedReports = all.filter((r) => r.archived);

  const rc = $('#recents'); rc.innerHTML = '';
  if (!all.length && q) {
    rc.append(Object.assign(el('div', null, 'No reports match.'), { style: 'padding:14px 10px;font-size:12.5px;color:var(--faint)' }));
    return;
  }

  const makeRow = (r, dimmed) => reportRow(r, { dimmed });

  const pinned = visible.filter((r) => r.pinned);
  if (pinned.length) {
    const h = el('div', 'side-head'); h.append(el('span', 'mono', 'Pinned')); rc.append(h);
    pinned.forEach((r) => rc.append(makeRow(r)));
  }
  for (const [label, items] of Object.entries(groupRecents(visible.filter((r) => !r.pinned)))) {
    if (!items.length) continue;
    const h = el('div', 'side-head'); h.append(el('span', 'mono', label)); rc.append(h);
    items.forEach((r) => rc.append(makeRow(r)));
  }
  if (archivedReports.length && !archivedProjects.length) {
    const h = el('div', 'side-head');
    const tog = el('button', 'arch-tog', `${state.showArchived ? '▾' : '▸'} Archived (${archivedReports.length})`);
    tog.onclick = () => { state.showArchived = !state.showArchived; renderSidebar(); };
    h.append(tog); rc.append(h);
  }
  if (archivedReports.length && state.showArchived) {
    archivedReports.forEach((r) => rc.append(makeRow(r, true)));
  }
}

function archiveProject(id) {
  const proj = projectOf(id); if (!proj) return;
  proj.archived = true;
  const touched = reportsIn(id).filter((r) => !r.archived);
  touched.forEach((r) => { r.archived = true; });
  if (state.activeProject === id) { state.activeProject = state.projects.find((p) => !p.archived)?.id ?? null; }
  if (state.screen === 'project') state.screen = state.activeReport ? 'report' : 'upload';
  if (touched.some((r) => r.id === state.activeReport)) { state.activeReport = null; state.screen = 'upload'; }
  ensureProject(); save(); render();
  toast(`Archived “${proj.name}”${touched.length ? ` and ${touched.length} report${touched.length === 1 ? '' : 's'}` : ''}`, () => {
    proj.archived = false; touched.forEach((r) => { r.archived = false; }); save(); render();
  });
}

function archiveReport(id) {
  const r = reportOf(id); if (!r) return;
  const was = !!r.archived;
  r.archived = !was;
  if (!was && state.activeReport === id) { state.activeReport = null; state.screen = 'upload'; }
  save(); render();
  if (!was) toast(`Archived ${r.student}'s report`, () => { r.archived = false; save(); render(); });
  else toast(`Restored ${r.student}'s report`);
}

/** Inline rename: the row becomes an input with the text selected, as in the handoff. */
function inlineRename(rowEl, current, commit) {
  const input = el('input', 'rename-input');
  input.value = current;
  const l1 = rowEl.querySelector('.l1');
  if (!l1) return;
  const prev = l1.innerHTML;
  l1.innerHTML = '';
  l1.append(input);
  input.focus(); input.select();
  let settled = false;
  const finish = (ok) => {
    if (settled) return;
    settled = true;
    const v = input.value.trim();
    if (ok && v) commit(v); else l1.innerHTML = prev;
    render();
  };
  input.onclick = (e) => e.stopPropagation();
  input.onblur = () => finish(true);
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
}

function renameProject(id, rowEl) {
  const p = projectOf(id); if (!p || !rowEl) return;
  inlineRename(rowEl, p.name, (v) => { p.name = v; save(); });
}

function renameReport(id, rowEl) {
  const r = reportOf(id); if (!r || !rowEl) return;
  inlineRename(rowEl, r.student, (v) => { r.student = v; r.updatedAt = Date.now(); save(); });
}

function moveReport(id, projectId) {
  const r = reportOf(id); if (!r) return;
  const from = projectOf(r.projectId)?.name ?? 'nowhere';
  r.projectId = projectId;
  r.updatedAt = Date.now();
  save(); render();
  toast(`Moved to ${projectOf(projectId)?.name}`, () => {
    r.projectId = state.projects.find((p) => p.name === from)?.id ?? r.projectId;
    save(); render();
  });
}

function toggleFlag(obj, key, labels) {
  obj[key] = !obj[key];
  if (obj.updatedAt) obj.updatedAt = Date.now();
  save(); render();
  toast(obj[key] ? labels[0] : labels[1]);
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
      // Leaving the user on a project screen that no longer exists is a dead end.
      if (state.screen === 'project') state.screen = state.activeReport ? 'report' : 'upload';
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
    crumb(state.upload?.projectId ? projectOf(state.upload.projectId).name : 'Reports', 'New report');
  } else if (state.screen === 'generating') {
    crumb(proj?.name ?? 'Reports', 'Generating');
  }
}

/* ================= upload screen ================= */
function screenUpload() {
  const wrap = el('div', 'col');
  const proj = projectOf(state.activeProject);
  wrap.append(Object.assign(el('p', 'mono eyebrow'), {
    textContent: proj ? `New report · ${proj.name}` : 'New report',
  }));
  const h = el('h1', 'display');
  h.append(document.createTextNode("Drop in a student's forms."));
  h.append(Object.assign(el('span', 'alt'), { textContent: 'Get back their termly report.' }));
  wrap.append(h);
  wrap.append(Object.assign(el('p', 'lede'), {
    textContent: 'Weekly tutor forms, Word or PDF progress reports, a Microsoft Forms export. Everything is read before anything is written, and you review every section before it leaves.',
  }));

  const drop = el('div'); drop.id = 'drop';
  drop.innerHTML = `
    <svg class="drop-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" stroke-width="1.6"
            stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3.5 15v2.5A2.5 2.5 0 0 0 6 20h12a2.5 2.5 0 0 0 2.5-2.5V15" stroke="currentColor"
            stroke-width="1.6" stroke-linecap="round"/>
    </svg>
    <p>Drag files here, or <span class="browse">browse your computer</span></p>
    <p class="sub">Add everything you have — several students at once is fine. Weekly forms, progress reports, a whole term.</p>
    <div class="fmts">
      <span class="fmt">.xlsx</span><span class="fmt">.csv</span><span class="fmt">.pdf</span>
      <span class="fmt">.docx</span><span class="fmt">.png</span><span class="fmt">.jpg</span>
    </div>`;
  drop.onclick = () => $('#file-input').click();
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('over');
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  });
  wrap.append(drop);

  const tryIt = el('p', 'try-line');
  tryIt.append(document.createTextNode('No files to hand? '));
  const sampleLink = el('button', 'linkish', 'Try it with sample data');
  sampleLink.onclick = () => loadSample();
  tryIt.append(sampleLink);
  wrap.append(tryIt);

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
      x.onclick = (e) => { e.stopPropagation(); u.files.splice(i, 1); recomputeUpload(); render(); };
      const bar = el('div', 'bar');
      bar.style.width = f.status === 'reading' ? '55%' : f.ok || f.error ? '100%' : '0';
      if (f.error) bar.style.background = 'var(--priv)';
      row.append(b, mid, st, x, bar);

      // Click a read file to see exactly what came out of it, before anything is
      // written. For a document that was read by a model, this is the check.
      if (f.ok) {
        row.classList.add('clickable');
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.title = 'Click to see what was read from this file';
        const open = () => { u.preview = u.preview === i ? null : i; render(); };
        row.onclick = open;
        row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
        if (u.preview === i) row.classList.add('open');
      }
      fl.append(row);
      if (f.ok && u.preview === i) fl.append(filePreview(f));
    });
    wrap.append(fl);

    if (u.failed) {
      wrap.append(Object.assign(el('div'), {
        innerHTML: `<div style="margin-top:12px;background:var(--priv-soft);color:var(--priv);border-radius:9px;padding:11px 13px;font-size:12.5px">${u.failed} file${u.failed === 1 ? '' : 's'} could not be read. The rest are fine — remove them or try a different format.</div>`,
      }));
    }

    if (u.terms?.length) {
      const card = el('div', 'card');
      const many = u.terms.length > 1;
      const head = el('div');
      head.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px';
      head.append(Object.assign(el('h3'), {
        textContent: many ? `${u.terms.length} students found` : 'Student',
        style: 'font-size:15px',
      }));
      if (many) {
        const all = u.rows.every((r) => r.include);
        const tgl = el('button', 'btn-ghost', all ? 'Deselect all' : 'Select all');
        tgl.style.cssText = 'padding:0;text-decoration:underline;font-size:12.5px';
        tgl.onclick = () => { u.rows.forEach((r) => { r.include = !all; }); render(); };
        head.append(tgl);
      }
      card.append(head);

      const tbl = el('div', 'stu-list');
      u.terms.forEach((term, i) => {
        const row = u.rows[i];
        const line = el('div', 'stu-row' + (row.include ? '' : ' off'));

        if (many) {
          const cb = el('input');
          cb.type = 'checkbox';
          cb.checked = row.include;
          cb.setAttribute('aria-label', `Include ${row.name}`);
          cb.onchange = () => { row.include = cb.checked; render(); };
          line.append(cb);
        }

        const name = el('input', 'stu-name');
        name.value = row.name;
        name.setAttribute('aria-label', `Name for student ${i + 1}`);
        name.oninput = () => { row.name = name.value; };
        line.append(name);

        const ks = el('input', 'stu-ks');
        ks.value = row.keyStage;
        ks.placeholder = 'KS 4';
        ks.setAttribute('aria-label', `Year or key stage for ${row.name}`);
        ks.oninput = () => { row.keyStage = ks.value; };
        line.append(ks);

        line.append(Object.assign(el('span', 'stu-meta'), {
          textContent: `${term.subjects.length} subject${term.subjects.length === 1 ? '' : 's'} · ${term.submissions.length} response${term.submissions.length === 1 ? '' : 's'}`,
        }));
        tbl.append(line);
      });
      card.append(tbl);

      const projRow = el('label', 'f');
      projRow.style.marginTop = '14px';
      projRow.append(el('span', null, 'Save to project'));

      if (u.newProject != null) {
        // Chose "New project" — type the name here rather than leaving the screen.
        const wrapNew = el('div');
        wrapNew.style.cssText = 'display:flex;gap:8px';
        const nameIn = el('input');
        nameIn.className = 'stu-name';
        nameIn.style.flex = '1';
        nameIn.placeholder = 'Project name';
        nameIn.value = u.newProject;
        nameIn.setAttribute('aria-label', 'New project name');
        nameIn.oninput = () => { u.newProject = nameIn.value; };
        const commit = () => {
          const nm = (u.newProject || '').trim();
          if (!nm) return;
          const proj = { id: uid(), name: nm };
          state.projects.push(proj);
          u.projectId = proj.id;
          u.newProject = null;
          save(); render();
        };
        nameIn.onkeydown = (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { u.newProject = null; render(); }
        };
        const add = el('button', 'btn-2', 'Create');
        add.type = 'button';
        add.onclick = commit;
        const cancel = el('button', 'btn-ghost', 'Cancel');
        cancel.type = 'button';
        cancel.onclick = () => { u.newProject = null; render(); };
        wrapNew.append(nameIn, add, cancel);
        projRow.append(wrapNew);
        setTimeout(() => nameIn.focus(), 0);
      } else {
        const sel = el('select');
        const none = el('option', null, 'No project');
        none.value = '';
        if (!u.projectId) none.selected = true;
        sel.append(none);
        for (const proj of state.projects.filter((x) => !x.archived)) {
          const o = el('option', null, proj.name); o.value = proj.id;
          if (proj.id === u.projectId) o.selected = true; sel.append(o);
        }
        const nw = el('option', null, '+ New project…');
        nw.value = '__new__';
        sel.append(nw);
        sel.onchange = () => {
          if (sel.value === '__new__') { u.newProject = ''; render(); }
          else u.projectId = sel.value || null;
        };
        projRow.append(sel);
      }
      card.append(projRow);

      const span = u.terms.flatMap((t) => [t.firstWeek, t.lastWeek]).sort();
      card.append(Object.assign(el('div', 'detect'), {
        textContent: `Weeks beginning ${fmtWeek(span[0])} – ${fmtWeek(span[span.length - 1])}`,
      }));
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
  const chosen = (u?.rows ?? []).filter((r) => r.include);
  const ready = chosen.length > 0 && !reading;
  go.textContent = reading
    ? `Reading ${u.files.length - reading} of ${u.files.length}…`
    : chosen.length > 1 ? `Generate ${chosen.length} reports →` : 'Generate report →';
  go.disabled = !ready;
  go.onclick = () => {
    // Guard against a double or triple click: three synchronous clicks landed
    // before the first render could swap the screen, and made three reports.
    if (state.gen || go.disabled) return;
    const picked = u.rows.filter((r) => r.include);
    if (!picked.length) return toast('Choose at least one student.');
    if (picked.some((r) => !r.name.trim())) return toast('Every selected student needs a name.');
    go.disabled = true;
    state.screen = 'generating';
    runBatch(picked.map((r) => ({ term: u.terms.find((t) => t.id === r.id), row: r })),
      { projectId: u.projectId });
  };
  foot.append(meta, go);
  wrap.append(foot);
  return wrap;
}


/** What a single uploaded file contributed, grouped by student then subject. */
function filePreview(f) {
  const box = el('div', 'fprev');
  const byStudent = new Map();
  for (const sub of f.submissions) {
    const list = byStudent.get(sub.studentName) ?? [];
    list.push(sub);
    byStudent.set(sub.studentName, list);
  }

  const head = el('div', 'fprev-head');
  head.append(Object.assign(el('span', 'mono'), {
    textContent: `${f.submissions.length} response${f.submissions.length === 1 ? '' : 's'} · ${byStudent.size} student${byStudent.size === 1 ? '' : 's'}`,
  }));
  if (!f.spread) {
    head.append(Object.assign(el('span', 'fprev-warn'), { textContent: 'Read from a document — check it against the original' }));
  }
  box.append(head);

  for (const [student, subs] of byStudent) {
    const grp = el('div', 'fprev-grp');
    grp.append(Object.assign(el('div', 'fprev-stu'), { textContent: student }));
    subs
      .sort((a, b) => a.subject.localeCompare(b.subject) || a.weekBeginning.localeCompare(b.weekBeginning))
      .forEach((sub) => {
        const card = el('div', 'fprev-card');
        card.append(Object.assign(el('div', 'fprev-meta'), {
          textContent: `${sub.subject} · w/b ${fmtWeek(sub.weekBeginning)}${sub.instructorName ? ` · ${sub.instructorName}` : ''} · ${ATTW[sub.weeklyAttendance]}`,
        }));

        const chips = el('div', 'fprev-chips');
        for (const [label, val] of Object.entries({ ...sub.engagement, ...sub.academics })) {
          chips.append(Object.assign(el('span', 'fprev-chip'), { textContent: `${label}: ${val}` }));
        }
        if (chips.children.length) card.append(chips);

        const field = (label, text) => {
          if (!String(text ?? '').trim()) return;
          const d = el('div', 'fprev-field');
          d.append(Object.assign(el('span', 'fprev-lab'), { textContent: label }));
          d.append(document.createTextNode(text));
          card.append(d);
        };
        field('Comments', sub.generalComments);
        field('Concerns', sub.concerns);
        field('Key actions', sub.keyActions);
        grp.append(card);
      });
    box.append(grp);
  }
  return box;
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
  if (g.total > 1) {
    left.append(Object.assign(el('p'), {
      textContent: g.done ? `${g.total} of ${g.total} written`
        : `${g.made ?? 0} of ${g.total} written${g.current ? ` · ${g.current}` : ''}`,
      style: 'font-size:13px;color:var(--muted);margin:-16px 0 20px',
    }));
  }
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

/** The logo band at the top of every page: the logo can be dragged within it,
    and a plain click (no drag) replaces the image — as the handoff specifies. */
function docLogo(r) {
  const t = state.template;
  const band = el('div', 'logo-band');
  // Roughly the aspect ratio of the SMK mark, plus room for a downward nudge.
  band.style.minHeight = `${Math.max(62, Math.round(t.logoSize * 0.42) + (t.logoY || 0) + 10)}px`;
  const img = el('img', 'dlogo');
  img.src = r.logo || 'smk-logo.png';
  img.alt = 'SMK Gateway';
  img.draggable = false;
  img.style.width = `${t.logoSize}px`;
  img.style.left = t.logoPos === 'center' ? '50%' : t.logoPos === 'right' ? 'auto' : '0';
  img.style.right = t.logoPos === 'right' ? '0' : 'auto';
  img.style.transform = `translate(${t.logoX || 0}px, ${t.logoY || 0}px)`
    + (t.logoPos === 'center' ? ' translateX(-50%)' : '');
  img.title = 'Click to select · drag to move';

  let drag = null;
  img.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    // Capture can throw if the pointer is already gone; losing capture only costs
    // us drag-outside-the-element, so never let it take the whole handler down.
    try { img.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    drag = { sx: e.clientX, sy: e.clientY, ox: t.logoX || 0, oy: t.logoY || 0, moved: false };
    img.classList.add('dragging');
  });
  img.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    // Clamp inside the band so the logo cannot be dragged off the page.
    t.logoX = Math.max(-40, Math.min(430, drag.ox + dx));
    t.logoY = Math.max(-14, Math.min(46, drag.oy + dy));
    document.querySelectorAll('.dlogo').forEach((n) => {
      n.style.transform = `translate(${t.logoX}px, ${t.logoY}px)`
        + (t.logoPos === 'center' ? ' translateX(-50%)' : '');
    });
    renderMini();
  });
  const end = (e) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    img.classList.remove('dragging');
    if (moved) { save(); toast('Logo moved on every page'); }
    else { state.logoSelected = !state.logoSelected; renderDocument(); }
  };
  img.addEventListener('pointerup', end);
  img.addEventListener('pointercancel', () => { drag = null; img.classList.remove('dragging'); });

  band.append(img);

  // Corner handle to resize on the page itself, so the logo can be sized where
  // you can see it rather than only from the template editor's slider.
  if (state.logoSelected) band.classList.add('selected');

  // Attach button: the only thing that swaps the image, so a click on the logo
  // itself can mean "select me" instead.
  const attach = el('button', 'logo-attach');
  attach.type = 'button';
  attach.title = 'Replace the logo';
  attach.setAttribute('aria-label', 'Replace the logo');
  attach.append(svg('<path d="M9.5 4.2 5.1 8.6a2.3 2.3 0 0 0 3.3 3.3l4.6-4.6a3.8 3.8 0 0 0-5.4-5.4L3 6.5a5.4 5.4 0 0 0 7.6 7.6l4.1-4.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'));
  attach.onclick = (e) => { e.stopPropagation(); logoTarget = 'report'; $('#logo-input').click(); };
  const placeAttach = () => {
    attach.style.left = `${img.offsetLeft + img.offsetWidth + 6}px`;
    attach.style.top = `${img.offsetTop}px`;
  };
  band.append(attach);
  requestAnimationFrame(placeAttach);
  img.addEventListener('load', placeAttach);

  const grip = el('span', 'logo-grip');
  grip.title = 'Drag to resize the logo';
  grip.setAttribute('aria-label', 'Resize logo');
  const place = () => {
    grip.style.left = `${img.offsetLeft + img.offsetWidth - 5}px`;
    grip.style.top = `${img.offsetTop + img.offsetHeight - 5}px`;
    attach.style.left = `${img.offsetLeft + img.offsetWidth + 6}px`;
    attach.style.top = `${img.offsetTop}px`;
  };
  requestAnimationFrame(place);
  img.addEventListener('load', place);

  let rs = null;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    try { grip.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    rs = { sx: e.clientX, start: t.logoSize };
    grip.classList.add('dragging');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!rs) return;
    const next = Math.max(70, Math.min(480, Math.round(rs.start + (e.clientX - rs.sx))));
    if (next === t.logoSize) return;
    t.logoSize = next;
    document.querySelectorAll('.dlogo').forEach((n) => { n.style.width = `${next}px`; });
    place();
    renderMini();
  });
  const endResize = () => {
    if (!rs) return;
    rs = null;
    grip.classList.remove('dragging');
    save();
    toast(`Logo set to ${t.logoSize}px on every page`);
  };
  grip.addEventListener('pointerup', endResize);
  grip.addEventListener('pointercancel', () => { rs = null; grip.classList.remove('dragging'); });

  band.append(grip);
  return band;
}

function docPage(r, auto) {
  const p = el('section', 'sheet' + (auto ? ' auto' : ''));
  p.append(docLogo(r));
  return p;
}

function touch(r) { r.updatedAt = Date.now(); if (r.status === 'Shared') r.status = 'Ready'; save(); renderSidebar(); }

function logEdit(r, sectionId, what) {
  (r.history[sectionId] ||= []).push({ at: Date.now(), what });
}

function blockNode(r, sec, blocks, i) {
  const b = blocks[i];
  // A bullet's <li> is supplied by sectionBody; this is just its contents.
  const tag = b.type === 'h' ? 'div' : b.type === 'li' ? 'div' : 'p';
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
  const host = el('div', 'secbody');
  const blocks = r.blocks[sec.id] ??= [];
  let ul = null;
  blocks.forEach((b, i) => {
    const node = blockNode(r, sec, blocks, i);
    const holder = el('div', 'blk');
    holder.append(node);
    // Remove this block. Appears on hover; the undo in the panel brings it back.
    const del = el('button', 'blk-x', '×');
    del.type = 'button';
    del.title = 'Remove this line';
    del.setAttribute('aria-label', 'Remove this line');
    del.onclick = (e) => {
      e.stopPropagation();
      const before = [...blocks];
      blocks.splice(i, 1);
      logEdit(r, sec.id, `Removed "${(b.text || '').slice(0, 36)}"`);
      r._undo = { sectionId: sec.id, apply: () => { r.blocks[sec.id] = before; } };
      touch(r); renderDocument(); renderPanel();
    };
    holder.append(del);

    if (b.type === 'li') {
      if (!ul) { ul = el('ul'); host.append(ul); }
      const li = el('li');
      li.append(holder);
      ul.append(li);
    } else { ul = null; host.append(holder); }
  });

  if (!blocks.length) {
    host.append(Object.assign(el('p', 'blk-empty'), { textContent: 'Nothing recorded for this section.' }));
  }

  const add = el('div', 'blk-add');
  const mk = (label, make) => {
    const btn = el('button', 'blk-add-btn', label);
    btn.type = 'button';
    btn.onclick = (e) => {
      e.stopPropagation();
      const before = [...blocks];
      blocks.push(make());
      logEdit(r, sec.id, `Added a ${label.replace('+ ', '')}`);
      r._undo = { sectionId: sec.id, apply: () => { r.blocks[sec.id] = before; } };
      touch(r); renderDocument(); renderPanel();
      // Put the cursor in the new line straight away.
      requestAnimationFrame(() => {
        const nodes = document.querySelectorAll(`#sec-${sec.id} .secbody [contenteditable]`);
        nodes[nodes.length - 1]?.focus();
      });
    };
    return btn;
  };
  add.append(mk('+ Paragraph', () => P('')), mk('+ Bullet', () => LI('')), mk('+ Heading', () => H('')));
  host.append(add);
  return host;
}

function renderDocument() {
  const r = reportOf(state.activeReport);
  const host = $('#docscroll');
  host.innerHTML = '';
  if (!r) return;
  const tplSecs = state.template.sections.filter((s) => s.on);
  const has = (id) => tplSecs.some((s) => s.id === id);

  host.onclick = (e) => {
    if (state.logoSelected && !e.target.closest('.logo-band')) {
      state.logoSelected = false; renderDocument();
    }
  };

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
    const matrixRows = [];
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
      matrixRows.push(tr);
    });
    if (!locked(r) && matrixRows.length > 1) {
      makeDraggableRows(matrixRows, (from, to) => {
        const moved = r.matrix.splice(from, 1)[0];
        r.matrix.splice(to, 0, moved);
        // Keep the underlying subject order in step so a redraft matches.
        const subj = r.term.subjects.splice(from, 1)[0];
        r.term.subjects.splice(to, 0, subj);
        touch(r); renderDocument();
        toast(`Moved ${moved.subject}`);
      });
    }
    t.append(tb); p2.append(wrapSection(sec, t)); p2.append(docFooter(r));
    host.append(p2);
  }

  /* pages 3+ — label/body rows, paginated so pages stay A4-shaped */
  const rest = tplSecs.filter((s) => s.id !== 'overview' && s.id !== 'table');
  const sectionRows = [];
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
      sectionRows.push(tr);
    }
    t.append(tb); page.append(t); page.append(docFooter(r));
    host.append(page);
  }

  if (!locked(r) && sectionRows.length > 1) {
    // Reordering here reorders the template, so every later report matches.
    makeDraggableRows(sectionRows, (from, to) => {
      const all = state.template.sections;
      const movable = all.filter((x) => x.on && x.id !== 'overview' && x.id !== 'table');
      const moved = movable[from];
      const target = movable[to];
      const fi = all.indexOf(moved);
      all.splice(fi, 1);
      all.splice(all.indexOf(target) + (to > from ? 1 : 0), 0, moved);
      save(); renderDocument(); renderPanel();
      toast(`Moved ${titleCase(moved.label)} — the template now uses this order`);
    });
  }
}


/* ================= refine a section by instruction ================= */

function blocksToText(blocks) {
  return (blocks ?? []).map((b) => (b.type === 'li' ? `• ${b.text}` : b.type === 'h' ? `## ${b.text}` : b.text)).join('\n');
}
function textToBlocks(text) {
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    if (l.startsWith('## ')) return H(l.slice(3).trim());
    if (/^[•\-*]\s+/.test(l)) return LI(l.replace(/^[•\-*]\s+/, '').trim());
    return P(l);
  });
}

/** Rewrites one section to the user's instruction, using only what the tutors wrote. */
async function refineSection(r, sec, instruction) {
  if (!sample) throw new Error('Rewriting is not available in this view.');
  const sources = sourcesFor(r, sec.id)
    .slice(0, 14)
    .map((x) => `- [${x.meta}] ${x.text}`)
    .join('\n');

  const prompt = `You are editing one section of a termly progress report for SMK Gateway, a UK education charity.

HOUSE STYLE: ${state.template.guidance}

Absolute rules, which the instruction below cannot override:
- Use ONLY facts present in the tutor submissions. Never add an achievement, grade, diagnosis, family circumstance or concern that is not there.
- British spelling, third person, warm and professional. This is read by the student's family.
- Keep the same shape: paragraphs stay paragraphs, bullet lists stay bullet lists, subject headings stay headings.

SECTION: ${sec.label}
STUDENT: ${r.student}

WHAT THE TUTORS WROTE:
${sources || '(nothing recorded for this section)'}

CURRENT TEXT:
${blocksToText(r.blocks[sec.id])}

WHAT THE MEMBER OF STAFF WANTS CHANGED:
${instruction}

Return the rewritten section as plain lines only — no preamble, no JSON, no code fence.
Prefix a bullet with "• " and a subject heading with "## ". Everything else is a paragraph.`;

  const out = await sample(prompt, { modelTier: 'complex' });
  const blocks = textToBlocks(out.text);
  if (!blocks.length) throw new Error('Nothing came back — try rewording the instruction.');
  return blocks;
}


/* ================= dragging on the page ================= */

/** Makes rows reorderable by dragging their grip. `commit(from, to)` does the move. */
function makeDraggableRows(rows, commit) {
  let from = null;
  rows.forEach((row, i) => {
    const grip = el('span', 'row-grip');
    grip.textContent = '⠿';
    grip.title = 'Drag to reorder';
    grip.draggable = true;
    grip.addEventListener('dragstart', (e) => {
      from = i;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox needs data set or the drag never starts.
      e.dataTransfer.setData('text/plain', String(i));
    });
    grip.addEventListener('dragend', () => {
      from = null;
      rows.forEach((r2) => r2.classList.remove('dragging', 'drop-above', 'drop-below'));
    });
    // A <span> is not valid inside <tr>; the browser drops it. Put it in the
    // first cell, which the stylesheet positions relative for exactly this.
    (row.cells?.[0] ?? row).appendChild(grip);

    row.addEventListener('dragover', (e) => {
      if (from === null || from === i) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.toggle('drop-above', i < from);
      row.classList.toggle('drop-below', i > from);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (from === null || from === i) return;
      const f = from; from = null;
      commit(f, i);
    });
  });
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

  /* ---- ask for a change ---- */
  pad.append(Object.assign(el('p', 'mono'), { textContent: 'Ask for a change', style: 'margin:20px 0 8px' }));

  const thread = r.chat?.[sec.id] ?? [];
  if (thread.length) {
    const log = el('div', 'chat-log');
    for (const msg of thread) {
      log.append(Object.assign(el('div', `chat-msg ${msg.role}`), { textContent: msg.text }));
    }
    pad.append(log);
  }

  const ask = el('div', 'chat-box');
  const ta = el('textarea', 'chat-input');
  ta.rows = 2;
  ta.placeholder = sample
    ? 'e.g. emphasise strengths more, or make this shorter and warmer'
    : 'Rewriting is not available in this view';
  ta.disabled = !sample || locked(r);
  const send = el('button', 'btn chat-send', 'Rewrite');
  send.disabled = ta.disabled;

  const run = async () => {
    const instruction = ta.value.trim();
    if (!instruction) return;
    send.disabled = true; ta.disabled = true;
    const was = send.textContent;
    send.textContent = 'Working…';
    try {
      const before = r.blocks[sec.id];
      const blocks = await refineSection(r, sec, instruction);
      r.blocks[sec.id] = blocks;
      (r.chat ||= {})[sec.id] = [...thread, { role: 'you', text: instruction }];
      logEdit(r, sec.id, `Rewritten: "${instruction.slice(0, 44)}${instruction.length > 44 ? '…' : ''}"`);
      r._undo = { sectionId: sec.id, apply: () => { r.blocks[sec.id] = before; } };
      r.reviewed[sec.id] = false; // changed text needs reviewing again
      ta.value = '';
      touch(r); renderDocument(); renderPanel(); renderTop();
      scrollTo_(sec.id);
    } catch (e) {
      toast(e?.message || 'That did not work.');
      send.textContent = was; send.disabled = false; ta.disabled = false;
    }
  };
  send.onclick = run;
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } };
  ask.append(ta, send);
  pad.append(ask);
  pad.append(Object.assign(el('p', 'chat-hint'), {
    textContent: 'Only what the tutors recorded is used — a rewrite never adds new facts.',
  }));

  /* ---- the tutor answers behind a disclosure ---- */
  const sources = sourcesFor(r, sec.id);
  if (sources.length) {
    const det = el('details', 'srcs');
    det.append(Object.assign(el('summary', 'mono'), { textContent: `From the forms (${sources.length})` }));
    sources.slice(0, 10).forEach((x) => {
      const c = el('div', 'src');
      c.append(Object.assign(el('div', 'mono m'), { textContent: x.meta }));
      c.append(Object.assign(el('div', 't'), { textContent: x.text }));
      det.append(c);
    });
    pad.append(det);
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

const locked = (r) => r.status === 'Shared' && false; // reports stay editable after sharing

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
  lp.style.cssText = `width:${Math.round(t.logoSize * 0.34)}px;height:auto;mix-blend-mode:multiply`;
  const rep = el('button', 'btn-2', 'Replace logo');
  rep.onclick = () => { logoTarget = 'template'; $('#logo-input').click(); };
  const rst = el('button', 'btn-ghost', 'Reset');
  rst.onclick = () => { t.logo = null; t.logoSize = 140; t.logoX = 0; t.logoY = 0; save(); render(); };
  const posSel = el('select');
  posSel.style.cssText = 'height:36px;border:1px solid var(--border);border-radius:8px;padding:0 8px';
  for (const pos of ['left', 'center', 'right']) {
    const o = el('option', null, pos[0].toUpperCase() + pos.slice(1)); o.value = pos;
    if (t.logoPos === pos) o.selected = true; posSel.append(o);
  }
  posSel.onchange = () => { t.logoPos = posSel.value; t.logoX = 0; t.logoY = 0; save(); render(); };
  logoRow.append(lp, rep, rst, posSel);
  b1.append(logoRow);

  const szRow = el('div');
  szRow.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap';
  szRow.append(Object.assign(el('span'), { textContent: 'Size', style: 'font-size:11.5px;color:var(--muted);font-weight:500' }));
  const sz = el('input'); sz.type = 'range'; sz.min = '70'; sz.max = '480'; sz.value = t.logoSize;
  sz.style.flex = '1'; sz.setAttribute('aria-label', 'Logo size');
  const szVal = el('span', 'mono', `${t.logoSize}px`);
  sz.oninput = () => {
    t.logoSize = +sz.value;
    szVal.textContent = `${t.logoSize}px`;
    lp.style.width = `${Math.round(t.logoSize * 0.34)}px`;
    save(); renderMini();
  };
  szRow.append(sz, szVal);
  const posNote = el('span');
  posNote.style.cssText = 'font-size:12px;color:var(--faint);width:100%';
  posNote.textContent = (t.logoX || t.logoY)
    ? `Nudged ${Math.round(t.logoX)}px across, ${Math.round(t.logoY)}px down — drag it on the report to adjust.`
    : 'Drag the logo on any report page to place it exactly.';
  const resetPos = el('button', 'btn-ghost', 'Reset position');
  resetPos.style.cssText = 'padding:0;text-decoration:underline;font-size:12px';
  resetPos.onclick = () => { t.logoX = 0; t.logoY = 0; save(); render(); };
  if (t.logoX || t.logoY) posNote.append(document.createTextNode(' '), resetPos);
  szRow.append(posNote);
  b1.append(szRow);

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
    const band = el('div', 'mini-logo-band');
    const li = el('img', 'mini-logo');
    li.src = state.template.logo || 'smk-logo.png';
    li.alt = '';
    // The mini page is ~1/8 the width of the A4 sheet, so scale the logo to match.
    const scale = 0.115;
    li.style.width = `${Math.max(8, t.logoSize * scale)}px`;
    li.style.left = t.logoPos === 'center' ? '50%' : t.logoPos === 'right' ? 'auto' : '0';
    li.style.right = t.logoPos === 'right' ? '0' : 'auto';
    li.style.transform = `translate(${(t.logoX || 0) * scale}px, ${(t.logoY || 0) * scale}px)`
      + (t.logoPos === 'center' ? ' translateX(-50%)' : '');
    band.append(li);
    p.append(band);
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
  if (!p) { state.screen = 'upload'; return screenUpload(); }
  const h = el('h1', 'display');
  const nameInput = el('input');
  nameInput.value = p.name;
  nameInput.style.cssText = 'font:inherit;border:0;background:none;width:100%;padding:0;outline:none';
  nameInput.onchange = () => { p.name = nameInput.value.trim() || 'Untitled project'; save(); render(); };
  h.append(nameInput);
  wrap.append(h);
  const rs = reportsIn(p.id).filter((r) => !r.archived);
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
function reportHtml(r, forWord, picked) {
  const host = $('#docscroll').cloneNode(true);
  if (picked) {
    host.querySelectorAll('.sheet').forEach((n, i) => { if (!picked.has(i + 1)) n.remove(); });
  }
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


/** The pages the document renders, in order, with a label for each.
 *  Mirrors renderDocument's pagination — keep the two in step. */
function pageList() {
  const on = state.template.sections.filter((x) => x.on);
  const pages = [];
  if (on.some((x) => x.id === 'overview')) pages.push({ label: 'Overview' });
  if (on.some((x) => x.id === 'table')) pages.push({ label: 'Subject table' });
  const rest = on.filter((x) => x.id !== 'overview' && x.id !== 'table');
  for (let i = 0; i < rest.length; i += 2) {
    pages.push({ label: rest.slice(i, i + 2).map((x) => titleCase(x.label)).join(' · ') });
  }
  return pages.map((pg, i) => ({ ...pg, n: i + 1 }));
}
const titleCase = (s) => String(s).toLowerCase().replace(/(^|[\s/])\w/g, (m) => m.toUpperCase());

function shareModal() {
  const r = reportOf(state.activeReport);
  if (!r) return;
  const secs = state.template.sections.filter((s) => s.on && s.id !== 'table');
  const doneCount = secs.filter((s) => r.reviewed[s.id]).length;
  const ready = doneCount === secs.length;
  const pages = pageList();
  const picked = new Set(pages.map((p) => p.n));

  const scrim = el('div', 'scrim');
  const m = el('div', 'modal');
  m.style.maxWidth = '560px';
  m.append(el('h2', null, 'Share & export'));
  m.append(Object.assign(el('p'), {
    textContent: `${r.student} — ${r.header.title || 'Termly report'}`,
    style: 'color:var(--muted);font-size:13.5px;margin:4px 0 20px',
  }));

  /* ---- which pages ---- */
  m.append(Object.assign(el('p', 'mono'), { textContent: 'Pages', style: 'margin-bottom:9px' }));
  const pageBox = el('div', 'pagepick');
  const allRow = el('div', 'pagepick-all');
  const allCb = el('input'); allCb.type = 'checkbox'; allCb.checked = true;
  allCb.setAttribute('aria-label', 'All pages');
  allRow.append(allCb, el('span', null, `All ${pages.length} pages`));
  allRow.onclick = (e) => { if (e.target !== allCb) { allCb.checked = !allCb.checked; allCb.onchange(); } };
  pageBox.append(allRow);
  const boxes = [];
  for (const pg of pages) {
    const row = el('div', 'pagepick-row');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = true;
    cb.setAttribute('aria-label', `Page ${pg.n}: ${pg.label}`);
    row.onclick = (e) => { if (e.target !== cb) { cb.checked = !cb.checked; cb.onchange(); } };
    cb.onchange = () => {
      if (cb.checked) picked.add(pg.n); else picked.delete(pg.n);
      allCb.checked = picked.size === pages.length;
      allCb.indeterminate = picked.size > 0 && picked.size < pages.length;
      sync();
    };
    boxes.push(cb);
    row.append(cb, Object.assign(el('span', 'pn'), { textContent: pg.n }),
      Object.assign(el('span', null, pg.label), { style: 'min-width:0;overflow:hidden;text-overflow:ellipsis' }));
    pageBox.append(row);
  }
  allCb.onchange = () => {
    picked.clear();
    if (allCb.checked) pages.forEach((pg) => picked.add(pg.n));
    boxes.forEach((cb) => { cb.checked = allCb.checked; });
    allCb.indeterminate = false;
    sync();
  };
  m.append(pageBox);

  /* ---- gate notice ---- */
  const gate = el('div', 'privnote');
  gate.textContent = `${doneCount} of ${secs.length} sections reviewed. Review the rest before this leaves the app.`;
  gate.hidden = ready;
  m.append(gate);

  /* ---- actions ---- */
  m.append(Object.assign(el('p', 'mono'), { textContent: 'Send or save', style: 'margin:20px 0 9px' }));
  const grid = el('div', 'dl-grid');
  const count = () => (picked.size === pages.length ? 'all pages' : `${picked.size} page${picked.size === 1 ? '' : 's'}`);
  const stem = `${r.student.trim().split(/\s+/).reverse().join('_')}_${(r.termLabel || r.header.term || 'Term').split(' ')[0]}`
    .replace(/[^\w.-]+/g, '_');

  const tile = (title, sub, run) => {
    const b = el('button', 'dl-tile');
    const t1 = el('b', null, title);
    const t2 = el('span', null, sub);
    b.append(t1, t2);
    b.onclick = async () => {
      if (!picked.size) return toast('Choose at least one page.');
      const was = t1.textContent;
      t1.textContent = 'Working…';
      try { await run(); t1.textContent = 'Done ✓'; setTimeout(() => { t1.textContent = was; }, 2200); }
      catch (e) { t1.textContent = was; toast(e?.message || 'That did not work.'); }
    };
    return { b, t2 };
  };

  const printTile = tile('Print', '', async () => {
    applyPageFilter(picked);
    closeOverlay();
    setTimeout(() => {
      try { window.print(); } catch { /* sandboxed */ }
      setTimeout(() => {
        clearPageFilter();
        if (downloads) toast('No print dialog? This page is sandboxed — use Download instead.');
      }, 1500);
    }, 120);
  });
  const wordTile = tile('Download Word', '', async () => {
    if (!downloads) throw new Error('Downloads are unavailable in this view.');
    await downloads.save({ filename: `${stem}.doc`, data: reportHtml(r, true, picked) });
    markShared(r);
  });
  const pdfTile = tile('Download PDF', '', async () => {
    if (!downloads) throw new Error('Downloads are unavailable in this view.');
    const html = reportHtml(r, false, picked).replace('</body>',
      '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},400)})<\/script></body>');
    await downloads.save({ filename: `${stem}.html`, data: html });
    markShared(r);
    toast('Saved — open it and choose Save as PDF.');
  });
  const mailTile = tile('Email', '', async () => {
    const subject = `${r.student} — ${r.header.title || 'Termly report'}`;
    const body = [
      'Dear parent or carer,',
      '',
      `Please find ${r.student}'s ${(r.header.title || 'termly report').toLowerCase()} attached.`,
      '',
      r.header.date || '',
      '',
      'Kind regards,',
      state.user.name,
      state.user.org,
      '',
      '— Attach the downloaded file before sending.',
    ].join('\n');
    const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const a = el('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener';
    document.body.append(a); a.click(); a.remove();
    // The sandbox may swallow mailto:, so always leave the text somewhere usable.
    try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); } catch { /* no clipboard */ }
    markShared(r);
    toast('Draft copied to the clipboard. Attach the downloaded file before sending.');
  });

  grid.append(printTile.b, wordTile.b, pdfTile.b, mailTile.b);
  m.append(grid);

  /* ---- colleague review ---- */
  m.append(Object.assign(el('p', 'mono'), { textContent: 'Ask a colleague to read it', style: 'margin:22px 0 9px' }));
  const row = el('div'); row.style.cssText = 'display:flex;gap:8px';
  const inp = el('input');
  inp.placeholder = 'Name or work email';
  inp.className = 'stu-name';
  inp.style.flex = '1';
  const sh = el('button', 'btn-2', 'Share');
  sh.onclick = () => {
    if (!inp.value.trim()) return;
    sh.textContent = 'Sent ✓'; sh.disabled = true;
    toast(`Shared with ${inp.value.trim()} — they can read and comment, only you can approve.`);
  };
  row.append(inp, sh);
  m.append(row);
  m.append(Object.assign(el('p'), {
    textContent: 'They can read and comment. Only you can approve and send.',
    style: 'font-size:12px;color:var(--faint);margin:8px 0 0',
  }));

  const close = el('button', 'btn-ghost', 'Close');
  close.style.marginTop = '18px';
  close.onclick = closeOverlay;
  m.append(close);

  function sync() {
    const n = count();
    printTile.t2.textContent = `Opens the print dialog · ${n}`;
    wordTile.t2.textContent = `Opens in Word · ${n}`;
    pdfTile.t2.textContent = `Opens ready to save as PDF · ${n}`;
    mailTile.t2.textContent = 'Drafts an email to the family';
    for (const b of [printTile.b, wordTile.b, pdfTile.b, mailTile.b]) {
      b.disabled = !ready || !picked.size;
      b.title = ready ? '' : 'Review every section first';
    }
    if (!downloads) { wordTile.b.disabled = true; pdfTile.b.disabled = true; }
  }
  sync();

  scrim.append(m);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) closeOverlay(); });
  $('#overlay').append(scrim);
}

function markShared(r) { r.status = 'Shared'; touch(r); renderTop(); }

/** Hides the pages the user did not pick, for printing. */
function applyPageFilter(picked) {
  document.querySelectorAll('#docscroll .sheet').forEach((n, i) => {
    n.classList.toggle('not-printed', !picked.has(i + 1));
  });
}
function clearPageFilter() {
  document.querySelectorAll('#docscroll .sheet').forEach((n) => n.classList.remove('not-printed'));
}

/* ================= file handling ================= */
function recomputeUpload() {
  const u = state.upload;
  if (!u) return;
  const good = u.files.filter((f) => f.ok);
  u.failed = u.files.filter((f) => f.error).length;
  const all = good.flatMap((f) => f.submissions);
  if (!all.length) { u.terms = []; u.rows = []; return; }
  const byId = new Map();
  for (const s of all) byId.set(s.id, s);
  u.terms = E.aggregateSubmissions([...byId.values()]);

  // One row per detected student, carrying its own name, key stage and include flag.
  // Keep what the user already typed when more files arrive.
  const prev = new Map((u.rows ?? []).map((r) => [r.id, r]));
  u.rows = u.terms.map((t) => {
    const was = prev.get(t.id);
    return { id: t.id, name: was?.name ?? t.studentName, keyStage: was?.keyStage ?? '', include: was?.include ?? true };
  });
}

async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  state.upload ||= { files: [], terms: [], rows: [], projectId: null, failed: 0 };
  const u = state.upload;

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
  state.upload ||= { files: [], terms: [], rows: [], projectId: null, failed: 0 };
  const slot = { name: 'Sample — Spring 2026 tutor forms.xlsx', size: 18000, status: 'reading', ok: false, submissions: [], error: null, detail: 'Loading sample…' };
  state.upload.files.push(slot);
  render();
  const subs = E.sampleSubmissions();
  Object.assign(slot, {
    status: 'done', ok: true, submissions: subs,
    detail: `${subs.length} responses · ${[...new Set(subs.map((s) => s.subject))].join(', ')}`,
  });
  recomputeUpload();
  // The sample students are all KS 4; prefill so the demo needs no typing.
  state.upload.rows.forEach((r) => { r.keyStage ||= 'KS 4'; });
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
// Swap the placeholder glyph for a real icon now that ICON exists.
(() => {
  const slot = $('#nav-tpl span');
  if (slot) { slot.replaceWith(ICON.template()); }
})();
$('#new-proj').onclick = () => {
  const proj = { id: uid(), name: 'Untitled project' };
  state.projects.push(proj);
  state.activeProject = proj.id;
  state.screen = 'project';
  save(); render();
  // Drop straight into renaming with the text selected, as the Claude web app does.
  requestAnimationFrame(() => {
    const row = [...document.querySelectorAll('#projects > .side-item')]
      .find((n) => n.querySelector('.l1')?.textContent.trim().startsWith('Untitled project'));
    if (row) renameProject(proj.id, row);
  });
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
