/*
 * SMK report engine — browser build.
 *
 * A direct port of src/lib/{formSchema,parse,aggregate,report,generate/template}.ts
 * so the hosted page and the Next.js app derive identical numbers from identical input.
 * Keep the two in step: the rules are documented in
 * .claude/skills/smk-form-schema/SKILL.md.
 */

export const ENGAGEMENT_ROWS = [
  'Attendance', 'Punctuality', 'Preparation for Class', 'Homework completion',
];
export const ACADEMIC_ROWS = [
  'Meets Deadlines', 'Quality of work', 'Understands key terms',
  'Applies knowledge and understanding to new concepts', 'Acts on feedback',
];

export const DERIVATION_NOTES = {
  attitudeToLearning: 'Mean of Preparation for Class, Homework completion and Acts on feedback',
  behaviourForLearning: 'Mean of Punctuality and Attendance (engagement grid)',
  contributionInLessons: 'Mean of Quality of work and Understands key terms',
  tutorAssessedProgress: 'Trend of the academics grid across the term',
};

export function normaliseHeader(h) {
  return String(h ?? '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[[\]().:*?/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SCALAR_FIELDS = [
  { key: 'studentName', aliases: ['student name', 'student', 'name of student', 'pupil name'], required: true },
  { key: 'instructorName', aliases: ['instructure name', 'instructor name', 'tutor name', 'tutor', 'instructor', 'teacher name'], required: true },
  { key: 'subject', aliases: ['subject', 'subject taught'], required: true },
  { key: 'weekBeginning', aliases: ['reporting week week beginning', 'reporting week', 'week beginning', 'week commencing'], required: true },
  { key: 'weeklyAttendance', aliases: ['weekly attendance', 'attendance for the week'], required: true },
  { key: 'concerns', aliases: ['concerns', 'areas of concern'], required: false },
  { key: 'keyActions', aliases: ['key actions', 'actions', 'next steps'], required: false },
  { key: 'generalComments', aliases: ['general comments', 'comments'], required: false },
];

const METADATA_ALIASES = ['id', 'start time', 'completion time', 'email', 'name', 'last modified time'];

const GRID_SPECS = [
  { grid: 'engagement', prefixes: ['student engagement', 'engagement'], rows: ENGAGEMENT_ROWS },
  { grid: 'academics', prefixes: ['academics', 'academic'], rows: ACADEMIC_ROWS },
];

const ROW_ALIASES = {
  'Attendance': ['attendance'],
  'Punctuality': ['punctuality'],
  'Preparation for Class': ['preparation for class', 'preparation', 'prep for class'],
  'Homework completion': ['homework completion', 'homework'],
  'Meets Deadlines': ['meets deadlines', 'deadlines'],
  'Quality of work': ['quality of work', 'work quality'],
  'Understands key terms': ['understands key terms', 'key terms'],
  'Applies knowledge and understanding to new concepts': [
    'applies knowledge and understanding to new concepts', 'applies knowledge to new concepts',
    'applies knowledge', 'application of knowledge'],
  'Acts on feedback': ['acts on feedback', 'feedback'],
};

const RATING_LOOKUP = {
  excellent: 'Excellent', good: 'Good', average: 'Average', poor: 'Poor',
  'not applicable': 'Not applicable', 'n a': 'Not applicable', na: 'Not applicable',
};
export const RATING_SCORE = { Excellent: 4, Good: 3, Average: 2, Poor: 1, 'Not applicable': null };

export function parseRating(v) {
  if (v === null || v === undefined) return null;
  return RATING_LOOKUP[normaliseHeader(v)] ?? null;
}

export function parseWeeklyAttendance(v) {
  if (v === null || v === undefined) return null;
  const t = normaliseHeader(v);
  if (!t) return null;
  if (t.startsWith('100')) return 'full';
  if (t.startsWith('0')) return 'none';
  if (t.includes('absent')) return 'partial';
  return null;
}

export function bandRating(mean) {
  if (mean === null || Number.isNaN(mean)) return 'Not applicable';
  if (mean >= 3.5) return 'Excellent';
  if (mean >= 2.5) return 'Good';
  if (mean >= 1.5) return 'Average';
  return 'Poor';
}

export function canonicalSubject(raw) {
  const cleaned = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  return cleaned.split(' ')
    .map((w) => (w.length <= 2 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

export const studentKey = (raw) => String(raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

function toMonday(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

export function parseWeekBeginning(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toMonday(value);
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const dmy = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? null : toMonday(date);
  }
  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : toMonday(iso);
}

function buildHeaderMap(headers) {
  const map = { scalars: {}, engagement: {}, academics: {}, unmapped: [] };
  for (const header of headers) {
    if (!header) continue;
    const norm = normaliseHeader(header);
    if (!norm) continue;
    let matched = false;
    for (const spec of GRID_SPECS) {
      const hasPrefix = spec.prefixes.some((p) => norm.startsWith(p));
      for (const row of spec.rows) {
        const aliases = ROW_ALIASES[row] ?? [row.toLowerCase()];
        if (aliases.some((a) => (hasPrefix ? norm.includes(a) : norm === a))) {
          const target = spec.grid === 'engagement' ? map.engagement : map.academics;
          if (!(row in target)) { target[row] = header; matched = true; }
          break;
        }
      }
      if (matched) break;
    }
    if (matched) continue;
    const field = SCALAR_FIELDS.find((f) => f.aliases.some((a) => norm === a || norm.startsWith(a)));
    if (field) { if (!(field.key in map.scalars)) map.scalars[field.key] = header; continue; }
    if (METADATA_ALIASES.includes(norm)) continue;
    map.unmapped.push(header);
  }
  return map;
}

const txt = (v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v).trim());

export function rowsToSubmissions(rows, headers) {
  const map = buildHeaderMap(headers);
  const issues = [];
  const submissions = [];

  const missing = SCALAR_FIELDS.filter((f) => f.required && !map.scalars[f.key]);
  if (missing.length) {
    missing.forEach((f) => issues.push({ row: 0, field: f.key, message: `No column found for "${f.aliases[0]}"` }));
    return { submissions: [], issues, unmappedHeaders: map.unmapped };
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const get = (key) => (map.scalars[key] ? (row[map.scalars[key]] ?? null) : null);
    const studentName = txt(get('studentName'));
    const subject = canonicalSubject(txt(get('subject')));
    const weekBeginning = parseWeekBeginning(get('weekBeginning'));

    if (!studentName && !subject && !weekBeginning) return;
    if (!studentName) return issues.push({ row: rowNumber, field: 'studentName', message: 'Missing student name — row skipped' });
    if (!subject) return issues.push({ row: rowNumber, field: 'subject', message: 'Missing subject — row skipped' });
    if (!weekBeginning) return issues.push({ row: rowNumber, field: 'weekBeginning', message: `Could not read the week beginning ("${txt(get('weekBeginning'))}") — row skipped` });

    const attendance = parseWeeklyAttendance(get('weeklyAttendance'));
    if (!attendance) issues.push({ row: rowNumber, field: 'weeklyAttendance', message: `Unrecognised attendance value ("${txt(get('weeklyAttendance'))}") — treated as partial` });

    const engagement = {};
    for (const [label, header] of Object.entries(map.engagement)) {
      const r = parseRating(row[header]); if (r) engagement[label] = r;
    }
    const academics = {};
    for (const [label, header] of Object.entries(map.academics)) {
      const r = parseRating(row[header]); if (r) academics[label] = r;
    }

    submissions.push({
      id: `${studentKey(studentName)}|${subject}|${weekBeginning}`,
      studentName: studentName.replace(/\s+/g, ' '),
      instructorName: txt(get('instructorName')),
      subject, weekBeginning,
      weeklyAttendance: attendance ?? 'partial',
      engagement, academics,
      concerns: txt(get('concerns')),
      keyActions: txt(get('keyActions')),
      generalComments: txt(get('generalComments')),
    });
  });

  return { submissions, issues, unmappedHeaders: map.unmapped };
}

/* ---------------- aggregation ---------------- */

const mean = (values) => {
  const nums = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

const scoresFor = (subs, grid, row) => subs.map((s) => (s[grid][row] ? RATING_SCORE[s[grid][row]] : null));

function modal(values) {
  const counts = new Map();
  for (const v of values) {
    if (!v || v === 'Not applicable') continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (!counts.size) return null;
  let best = null, bestCount = -1;
  for (const r of ['Excellent', 'Good', 'Average', 'Poor']) {
    const c = counts.get(r) ?? 0;
    if (c > bestCount) { best = r; bestCount = c; }
  }
  return best;
}

function nonEmpty(values) {
  const seen = new Set(); const out = [];
  for (const v of values) {
    const t = String(v ?? '').trim(); if (!t) continue;
    const k = t.toLowerCase(); if (seen.has(k)) continue;
    seen.add(k); out.push(t);
  }
  return out;
}

function progressBand(trend) {
  const points = trend.map((t) => t.mean).filter((m) => m !== null);
  if (!points.length) return 'Developing';
  const overall = points.reduce((a, b) => a + b, 0) / points.length;
  const mid = Math.floor(points.length / 2);
  const first = points.slice(0, mid || 1);
  const second = points.slice(mid || 1);
  const fm = first.reduce((a, b) => a + b, 0) / first.length;
  const sm = second.length ? second.reduce((a, b) => a + b, 0) / second.length : fm;
  const delta = sm - fm;
  if (overall >= 3.4 || (overall >= 2.8 && delta >= 0.25)) return 'Very good';
  if (overall < 2.0 || (overall < 2.4 && delta <= -0.25)) return 'Needs support';
  return 'Developing';
}

function aggregateSubject(subject, subs) {
  const byWeek = [...subs].sort((a, b) => a.weekBeginning.localeCompare(b.weekBeginning));
  const engagementMeans = {}; const academicMeans = {};
  for (const row of ENGAGEMENT_ROWS) { const m = mean(scoresFor(byWeek, 'engagement', row)); if (m !== null) engagementMeans[row] = m; }
  for (const row of ACADEMIC_ROWS) { const m = mean(scoresFor(byWeek, 'academics', row)); if (m !== null) academicMeans[row] = m; }
  const academicTrend = byWeek.map((s) => ({
    weekBeginning: s.weekBeginning,
    mean: mean(Object.values(s.academics).map((r) => (r ? RATING_SCORE[r] : null))),
  }));
  return {
    subject,
    instructors: [...new Set(byWeek.map((s) => s.instructorName).filter(Boolean))],
    weekCount: new Set(byWeek.map((s) => s.weekBeginning)).size,
    attitudeToLearning: bandRating(mean([
      engagementMeans['Preparation for Class'] ?? null,
      engagementMeans['Homework completion'] ?? null,
      academicMeans['Acts on feedback'] ?? null,
    ])),
    behaviourForLearning: bandRating(mean([
      engagementMeans['Punctuality'] ?? null, engagementMeans['Attendance'] ?? null,
    ])),
    contributionInLessons: bandRating(mean([
      academicMeans['Quality of work'] ?? null, academicMeans['Understands key terms'] ?? null,
    ])),
    tutorAssessedProgress: progressBand(academicTrend),
    concerns: nonEmpty(byWeek.map((s) => s.concerns)),
    keyActions: nonEmpty(byWeek.map((s) => s.keyActions)),
    generalComments: nonEmpty(byWeek.map((s) => s.generalComments)),
  };
}

function aggregateAttendance(subs) {
  const weeks = [...subs]
    .sort((a, b) => a.weekBeginning.localeCompare(b.weekBeginning) || a.subject.localeCompare(b.subject))
    .map((s) => ({
      weekBeginning: s.weekBeginning, subject: s.subject,
      attendance: s.weeklyAttendance, punctuality: s.engagement['Punctuality'] ?? null,
    }));

  const byWeek = new Map();
  for (const w of weeks) { const l = byWeek.get(w.weekBeginning) ?? []; l.push(w); byWeek.set(w.weekBeginning, l); }

  let fullWeeks = 0, partialWeeks = 0, absentWeeks = 0;
  const summary = [];
  for (const [weekBeginning, entries] of [...byWeek.entries()].sort()) {
    let attendance;
    if (entries.every((e) => e.attendance === 'full')) { fullWeeks++; attendance = 'full'; }
    else if (entries.every((e) => e.attendance === 'none')) { absentWeeks++; attendance = 'none'; }
    else { partialWeeks++; attendance = 'partial'; }
    summary.push({
      weekBeginning,
      subjects: [...new Set(entries.map((e) => e.subject))].sort(),
      attendance, punctuality: modal(entries.map((e) => e.punctuality)),
    });
  }
  return { weeks, summary, distinctWeeks: byWeek.size, fullWeeks, partialWeeks, absentWeeks, modalPunctuality: modal(weeks.map((w) => w.punctuality)) };
}

export function aggregateSubmissions(submissions) {
  const byStudent = new Map();
  for (const s of submissions) {
    const k = studentKey(s.studentName);
    const l = byStudent.get(k) ?? []; l.push(s); byStudent.set(k, l);
  }
  const terms = [];
  for (const [key, subs] of byStudent) {
    const bySubject = new Map();
    for (const s of subs) { const l = bySubject.get(s.subject) ?? []; l.push(s); bySubject.set(s.subject, l); }
    const sorted = subs.map((s) => s.weekBeginning).sort();
    terms.push({
      id: key.replace(/[^a-z0-9]+/g, '-'),
      studentName: subs[0].studentName,
      submissions: subs,
      subjects: [...bySubject.entries()].map(([sub, ss]) => aggregateSubject(sub, ss)).sort((a, b) => a.subject.localeCompare(b.subject)),
      attendance: aggregateAttendance(subs),
      firstWeek: sorted[0] ?? '', lastWeek: sorted[sorted.length - 1] ?? '',
    });
  }
  return terms.sort((a, b) => a.studentName.localeCompare(b.studentName));
}

const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

export function reportingDateLabel(firstWeek, lastWeek) {
  if (!firstWeek || !lastWeek) return '';
  const a = new Date(firstWeek), b = new Date(lastWeek);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}${sameYear ? '' : ` ${a.getUTCFullYear()}`} TO ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}

export function academicYearLabel(firstWeek) {
  if (!firstWeek) return '';
  const d = new Date(firstWeek), y = d.getUTCFullYear();
  return d.getUTCMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

export function termLabel(firstWeek, lastWeek) {
  if (!firstWeek) return '';
  const s = new Date(firstWeek), e = new Date(lastWeek || firstWeek);
  const m = s.getUTCMonth();
  const name = m >= 8 && m <= 11 ? 'AUTUMN TERM' : m <= 2 ? 'SPRING TERM' : 'SUMMER TERM';
  return `${name} (${MONTHS[s.getUTCMonth()].slice(0, 3)} - ${MONTHS[e.getUTCMonth()].slice(0, 3)} ${e.getUTCFullYear()})`;
}

export function defaultSetup(term) {
  const tiers = {}, averageGrades = {};
  for (const s of term.subjects) { tiers[s.subject] = ''; averageGrades[s.subject] = 'n/a'; }
  return {
    year: '', academicYear: academicYearLabel(term.firstWeek),
    termLabel: termLabel(term.firstWeek, term.lastWeek),
    reportingDateLabel: reportingDateLabel(term.firstWeek, term.lastWeek),
    tiers, averageGrades,
  };
}

export const subjectWithTier = (subject, tier) => (String(tier ?? '').trim() ? `${subject} (${tier.trim()})` : subject);

export function buildMatrix(term, setup, content) {
  return term.subjects.map((s) => ({
    subject: s.subject,
    tier: setup.tiers[s.subject] ?? '',
    attitudeToLearning: s.attitudeToLearning,
    behaviourForLearning: s.behaviourForLearning,
    contributionInLessons: s.contributionInLessons,
    curriculumStrengths: content.subjects?.[s.subject]?.curriculumStrengths ?? '',
    curriculumAreasForDevelopment: content.subjects?.[s.subject]?.areasForDevelopment ?? '',
    averageGrade: setup.averageGrades[s.subject] || 'n/a',
    tutorAssessedProgress: s.tutorAssessedProgress,
  }));
}

/* ---------------- deterministic fallback ---------------- */

const firstName = (full) => String(full).trim().split(/\s+/)[0] || full;
const sentence = (t) => { const s = String(t).trim(); return !s ? '' : /[.!?]$/.test(s) ? s : `${s}.`; };

function toBullets(entries) {
  const out = [];
  for (const entry of entries) {
    for (const part of String(entry).split(/(?<=[.;])\s+/)) {
      const clean = part.trim().replace(/^[-•]\s*/, '');
      if (clean.length > 3) out.push(sentence(clean));
    }
  }
  return [...new Set(out)];
}

const joinList = (items) =>
  !items.length ? '' : items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

export function generateFromTemplate(term) {
  const name = firstName(term.studentName);
  const subjectNames = term.subjects.map((s) => s.subject);
  const subjects = {}, successes = {}, challenges = {};

  for (const s of term.subjects) {
    subjects[s.subject] = {
      curriculumStrengths: toBullets(s.generalComments).slice(0, 3).join(' ') || 'No strengths recorded.',
      areasForDevelopment: toBullets(s.concerns).slice(0, 3).join(' ') || 'No areas recorded.',
    };
    successes[s.subject] = toBullets(s.generalComments).slice(0, 6);
    challenges[s.subject] = toBullets(s.concerns).slice(0, 8);
  }

  const a = term.attendance;
  const parts = [`${name} attended ${a.fullWeeks} of ${a.distinctWeeks} weeks in full during this reporting period.`];
  if (a.partialWeeks) parts.push(`There ${a.partialWeeks === 1 ? 'was' : 'were'} ${a.partialWeeks} week${a.partialWeeks === 1 ? '' : 's'} with some absence.`);
  if (a.absentWeeks) parts.push(`${a.absentWeeks} week${a.absentWeeks === 1 ? ' was' : 's were'} missed entirely.`);
  if (a.modalPunctuality === 'Average' || a.modalPunctuality === 'Poor') parts.push('Punctuality has been a recurring concern; lost minutes accumulate and impact learning time.');
  else if (a.modalPunctuality) parts.push(`Punctuality has been ${a.modalPunctuality.toLowerCase()}.`);

  return {
    overview: [
      `${name} is a capable and engaged student who has made positive progress across ${joinList(subjectNames)} during the reporting period.`,
      `Tutors report ${joinList([...new Set(term.subjects.map((s) => s.attitudeToLearning.toLowerCase()))])} attitude to learning.`,
      'Continued focus on the areas identified below will help build on this progress next term.',
    ].join(' '),
    subjects,
    attendanceNarrative: parts.join(' '),
    cognitionAndLearning: [
      `In lessons, ${name} demonstrates a ${term.subjects[0]?.attitudeToLearning.toLowerCase() ?? 'positive'} attitude towards learning and engages with classroom activities.`,
      ...term.subjects.map((s) => `${name} has shown ${s.tutorAssessedProgress.toLowerCase()} progress in ${s.subject} this term, with ${s.attitudeToLearning.toLowerCase()} attitude to learning and ${s.contributionInLessons.toLowerCase()} contribution in lessons. ${sentence(s.generalComments[0] ?? '')}`.trim()),
    ].join('\n\n'),
    successes, challenges,
    targets: toBullets(term.subjects.flatMap((s) => s.keyActions)).slice(0, 12),
    communicationAndInteraction: `${name} engages with staff and peers during sessions. Tutor comments across the term describe ${name}'s contribution in lessons as ${joinList([...new Set(term.subjects.map((s) => s.contributionInLessons.toLowerCase()))])}.`,
    socialEmotionalMentalHealth: 'No specific concerns have been recorded in the tutor submissions for this reporting period. Please review and amend if staff hold additional context.',
    sensoryPhysical: 'No specific sensory or physical observations have been recorded in the tutor submissions for this reporting period. Please review and amend if staff hold additional context.',
  };
}
