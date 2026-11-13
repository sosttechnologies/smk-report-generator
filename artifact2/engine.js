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


/* ---------------- editable document chrome ---------------- */

/**
 * Every fixed string in the report, so staff can change any of it.
 * Held on the report rather than hard-coded, which means edits survive into the
 * downloaded file and SMK can adjust their own wording without a code change.
 */
export function defaultLabels() {
  return {
    title1: 'INTERIM TERMLY REPORT',
    title2: 'REPORTING DATE:',
    student: 'STUDENT',
    year: 'YEAR',
    academicYear: 'ACADEMIC YEAR',
    term: 'TERM',
    overview: 'OVERVIEW',
    matrix: [
      'Subject and Tier', 'Attitude To Learning', 'Behaviour For Learning',
      'Contribution In Lessons', 'Curriculum Strengths', 'Curriculum Areas For Development',
      'Average score/grade on tests and mocks', 'Tutor Assessed Progress',
    ],
    attendance: 'Attendance',
    attendanceCols: ['Week beginning', 'Subjects', 'Attendance', 'Punctuality'],
    cognition: 'Cognition and Learning',
    successes: 'Successes and Achievements',
    challenges: 'Challenges or Concerns',
    targets: 'Targets or Goals',
    communication: 'Communication and Interaction',
    semh: 'Social, Emotional and Mental Health',
    sensory: 'Sensory and/or Physical Observations',
    footerAddress: 'Ground Floor, 599 Avebury Boulevard, Milton Keynes MK9 3HR',
    footerPhone: '07908 166 261',
    footerEmail: 'info@sievemk.org.uk',
    footerLegal: 'A company limited by guarantee (number 7886477) and a Registered Charity (number 1146451)',
  };
}

/* ---------------- pseudonymisation ---------------- */

/**
 * Replaces student and tutor names with tokens before anything is sent to a model,
 * and puts them back in the answer. Mirrors src/lib/pseudonymise.ts in the server app.
 *
 * This is NOT anonymisation: pseudonymised data is still personal data under UK GDPR,
 * because the mapping that reverses it lives in this page. It demonstrates data
 * minimisation; it removes no legal obligation.
 *
 * It applies to DRAFTING only. Reading a PDF or Word file cannot be pseudonymised —
 * the names are the thing the model is being asked to read.
 */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function pseudonymise(term) {
  const studentToken = 'Student A';
  const map = { [studentToken]: term.studentName };
  const pairs = [];

  const full = String(term.studentName).trim().replace(/\s+/g, ' ');
  pairs.push([full, studentToken]);
  for (const part of full.split(' ')) if (part.length > 2) pairs.push([part, studentToken]);

  const tutors = [...new Set(term.submissions.map((s) => s.instructorName).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  tutors.forEach((tutor, i) => {
    const token = `Tutor ${i + 1}`;
    map[token] = tutor;
    pairs.push([tutor, token]);
    for (const piece of tutor.split(/[.\s]+/)) if (piece.length > 2) pairs.push([piece, token]);
  });

  pairs.sort((a, b) => b[0].length - a[0].length);
  const scrub = (text) => {
    let out = String(text ?? '');
    for (const [real, token] of pairs) out = out.replace(new RegExp(`\\b${escapeRe(real)}\\b`, 'gi'), token);
    return out;
  };

  const masked = {
    ...term,
    id: 'student-a',
    studentName: studentToken,
    submissions: term.submissions.map((s, i) => ({
      ...s,
      id: `student-a|${s.subject}|${s.weekBeginning}|${i}`,
      studentName: studentToken,
      instructorName: `Tutor ${tutors.indexOf(s.instructorName) + 1}`,
      concerns: scrub(s.concerns), keyActions: scrub(s.keyActions), generalComments: scrub(s.generalComments),
    })),
    subjects: term.subjects.map((sub) => ({
      ...sub,
      instructors: sub.instructors.map((t) => `Tutor ${tutors.indexOf(t) + 1}`),
      concerns: sub.concerns.map(scrub), keyActions: sub.keyActions.map(scrub),
      generalComments: sub.generalComments.map(scrub),
    })),
  };

  return { term: masked, pseudonym: { map } };
}

export function rehydrate(value, pseudonym) {
  const pairs = Object.entries(pseudonym.map).sort((a, b) => b[0].length - a[0].length);
  const walk = (node) => {
    if (typeof node === 'string') {
      let out = node;
      for (const [token, real] of pairs) out = out.replace(new RegExp(escapeRe(token), 'g'), real);
      return out;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    return node;
  };
  return walk(value);
}

const RISK_PATTERNS = [
  [/\b(?:\d{1,4}\s+)?[A-Z][a-z]+\s(?:Road|Street|Avenue|Lane|Close|Drive|Way|Court)\b/, 'Looks like an address'],
  [/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/, 'Looks like a postcode'],
  [/\b(?:07\d{9}|\+44\s?\d{10})\b/, 'Looks like a phone number'],
  [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/, 'Contains an email address'],
  [/\b(?:mum|mother|dad|father|parent|carer|guardian|brother|sister|sibling|grandma|grandad)\b/i, 'Mentions a family member'],
  [/\b(?:diagnos|medicat|prescri|autis|dyslex|anxiet|depress|therap)\w*/i, 'Health detail — Article 9 special category data'],
  [/\b(?:ADHD|ASD|SEN|SEND|EHCP|CAMHS|IEP)\b/, 'SEND or health acronym — Article 9 special category data'],
  [/\b(?:social worker|safeguarding|child protection|looked after)\b/i, 'Safeguarding language — review before sending'],
];

export function findResidualRisks(term) {
  const out = [];
  for (const subject of term.subjects) {
    for (const text of [...subject.generalComments, ...subject.concerns, ...subject.keyActions]) {
      for (const [re, reason] of RISK_PATTERNS) {
        if (re.test(text)) { out.push({ subject: subject.subject, text, reason }); break; }
      }
    }
  }
  return out;
}

/* ---------------- built-in sample ---------------- */
/**
 * Synthetic data for the "Try it with sample data" button.
 *
 * The names here are deliberately unmistakable placeholders — "Alex Sample",
 * "Tutor A" — rather than realistic ones. A realistic name in sample data can be
 * mistaken for a real child, or coincide with one.
 */
export function sampleSubmissions() {
  return [...sampleStudent('Alex Sample'), ...sampleExtra()];
}

/** Two more synthetic students, so the multi-student path is easy to try. */
function sampleExtra() {
  const W = ['2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25'];
  const mk = (student, subject, tutor, rows) => rows.map((w, i) => ({
    id: `${student.toLowerCase().replace(/[^a-z0-9]+/g, '-')}|${subject}|${W[i]}`,
    studentName: student, instructorName: tutor, subject, weekBeginning: W[i],
    weeklyAttendance: w.att,
    engagement: { Attendance: w.e[0], Punctuality: w.e[1], 'Preparation for Class': w.e[2], 'Homework completion': w.e[3] },
    academics: { 'Meets Deadlines': w.a[0], 'Quality of work': w.a[1], 'Understands key terms': w.a[2],
      'Applies knowledge and understanding to new concepts': w.a[3], 'Acts on feedback': w.a[4] },
    concerns: w.c, keyActions: w.k, generalComments: w.g,
  }));
  const E4 = 'Excellent', G = 'Good', A = 'Average', P = 'Poor';
  return [
    ...mk('Robin Example', 'English Language', 'Tutor B', [
      { att:'full', e:[E4,E4,E4,E4], a:[E4,E4,E4,G,E4], c:'Occasionally repetitive sentence structure.', k:'Experiment with varied sentence openings.', g:'Excellent comprehension and confident contribution to group discussion.' },
      { att:'full', e:[E4,E4,E4,E4], a:[E4,E4,E4,E4,E4], c:'None recorded this week.', k:'Extend into comparative analysis.', g:'Reads widely and brings a strong vocabulary to written work.' },
      { att:'full', e:[E4,E4,E4,G], a:[E4,E4,E4,G,E4], c:'Handwriting and presentation under time pressure.', k:'Practise timed paragraphs.', g:'Thoughtful and well-structured creative writing.' },
      { att:'full', e:[E4,E4,E4,E4], a:[E4,E4,E4,E4,E4], c:'None identified.', k:'Begin an independent wider-reading log.', g:'Confident, articulate and supportive of peers in discussion.' },
    ]),
    ...mk('Robin Example', 'Maths', 'Tutor A', [
      { att:'full', e:[E4,E4,G,G], a:[G,G,E4,G,E4], c:'Does not always show working on multi-step problems.', k:'Insist on a written method for every multi-step question.', g:'Quick and accurate with number work and fractions.' },
      { att:'full', e:[E4,E4,G,G], a:[G,G,E4,G,E4], c:'Working out still skipped when confident.', k:'Model the full method each session.', g:'Secure times tables and strong mental arithmetic.' },
      { att:'full', e:[E4,E4,E4,G], a:[G,E4,E4,G,E4], c:'Word problems require careful re-reading.', k:'Underline key information before solving.', g:'Growing confidence with ratio and proportion.' },
      { att:'full', e:[E4,E4,E4,E4], a:[E4,E4,E4,G,E4], c:'None significant.', k:'Introduce extension problems.', g:'Excellent focus and a positive influence in the group.' },
    ]),
    ...mk('Sam Placeholder', 'Maths', 'Tutor A', [
      { att:'partial', e:[A,A,A,P], a:[P,A,A,P,A], c:'Attendance and homework completion are the main barriers to progress.', k:'Contact family to agree an attendance plan.', g:'Works carefully when present; improved accuracy in geometry.' },
      { att:'full', e:[G,A,G,A], a:[A,G,G,A,G], c:'Homework completion still inconsistent.', k:'Shorter, more frequent homework tasks.', g:'Noticeably more settled this week and willing to ask for help.' },
      { att:'partial', e:[A,A,A,P], a:[P,A,A,P,A], c:'Missed two sessions; gaps now showing in algebra.', k:'Plan a catch-up session on algebraic manipulation.', g:'Positive attitude when he does attend.' },
      { att:'full', e:[G,G,G,A], a:[A,G,G,A,G], c:'Needs to build independent revision habits.', k:'Provide a structured revision checklist.', g:'Good progress on geometry. Responding well to one-to-one explanation.' },
    ]),
  ];
}

function sampleStudent(name) {
  const W = ['2026-05-04','2026-05-11','2026-05-18','2026-05-25','2026-06-01','2026-06-08'];
  const E4='Excellent', G='Good', A='Average';
  const mk = (subject, tutor, weeks) => weeks.map((w, i) => ({
    id: `alex-sample|${subject}|${W[i]}`,
    studentName: 'Alex Sample', instructorName: tutor, subject, weekBeginning: W[i],
    weeklyAttendance: w.att,
    engagement: { Attendance: w.e[0], Punctuality: w.e[1], 'Preparation for Class': w.e[2], 'Homework completion': w.e[3] },
    academics: { 'Meets Deadlines': w.a[0], 'Quality of work': w.a[1], 'Understands key terms': w.a[2],
      'Applies knowledge and understanding to new concepts': w.a[3], 'Acts on feedback': w.a[4] },
    concerns: w.c, keyActions: w.k, generalComments: w.g,
  }));

  const out = [
    ...mk('Maths', 'Tutor A', [
      { att:'full', e:[E4,G,E4,G], a:[G,G,E4,A,E4], c:'Limited resilience when faced with challenging algebra; gives up quickly on multi-step problems.', k:'Set three short practice questions between sessions to build persistence.', g:'Strong participation and engagement in lessons. Grasps new concepts quickly when introduced visually.' },
      { att:'full', e:[E4,G,E4,A], a:[G,E4,E4,G,E4], c:'Homework completion inconsistent this week.', k:'Agree a fixed homework slot with family.', g:'Secure on surds and index laws. Asked thoughtful questions about geometric proof.' },
      { att:'full', e:[E4,E4,E4,G], a:[E4,E4,E4,G,E4], c:'Handwriting legibility continues to affect marking of working out.', k:'Practise setting out working in a structured format.', g:'Excellent session. Confident across most of all topics covered this term.' },
      { att:'partial', e:[G,A,G,A], a:[G,G,G,A,G], c:'Fluctuating energy levels and frequent fatigue, noticeably lower engagement in the morning session.', k:'Review session timing with family.', g:'Still contributing well despite tiredness. Good recall of previous content.' },
      { att:'full', e:[E4,E4,E4,G], a:[E4,E4,E4,G,E4], c:'Inconsistent independent revision between sessions.', k:'Introduce a weekly retrieval quiz.', g:'Very strong week. Applied algebra confidently to unfamiliar geometry questions.' },
      { att:'full', e:[E4,E4,E4,E4], a:[E4,E4,E4,G,E4], c:'Needs to maintain pace under timed conditions.', k:'Begin timed topic tests next term.', g:'Excellent attitude throughout. Most of all topics now secure.' },
    ]),
    ...mk('English Language', 'Tutor B', [
      { att:'full', e:[E4,A,G,A], a:[A,G,G,A,G], c:'Punctuality — arrived fifteen minutes late. Homework not submitted.', k:'Set a reminder the evening before each session.', g:'Positive attitude towards learning and good social skills with peers in the group.' },
      { att:'full', e:[E4,A,G,G], a:[G,G,G,A,E4], c:'Proofreading habits and attention to detail; SPaG errors recur in redrafts.', k:'Introduce a structured proofreading checklist.', g:'Increasing confidence in creative writing. Responds very well to structured guidance and feedback.' },
      { att:'full', e:[E4,G,E4,G], a:[G,E4,E4,G,E4], c:'Reading speed when tackling longer unseen texts.', k:'Ten minutes independent reading daily.', g:'Much improvement in deliberate use of language techniques. Strong curiosity and willingness to ask questions.' },
      { att:'partial', e:[G,A,G,A], a:[A,G,G,A,G], c:'Flexibility when responding to unfamiliar exam questions and perspectives.', k:'Practise one unseen extract per week.', g:'Demonstrates resilience when facing academic challenges even on a tired week.' },
      { att:'full', e:[E4,G,E4,G], a:[G,E4,E4,G,E4], c:'Technical vocabulary when analysing language features.', k:'Build a personal glossary of analytical terms.', g:'Sensitive and creative writing this week. Becoming more willing to tackle challenging tasks.' },
      { att:'full', e:[E4,G,E4,E4], a:[E4,E4,E4,G,E4], c:'Continue developing fuller paragraphs in analytical responses.', k:'Apply the point-evidence-analysis structure independently.', g:'Excellent engagement. Confidence in analytical writing has grown markedly across the term.' },
    ]),
    ...mk('Sciences', 'Tutor C', [
      { att:'full', e:[E4,A,G,A], a:[A,G,G,A,G], c:'Punctuality and time management. Homework completion inconsistent.', k:'Agree a consistent routine for arriving on time.', g:'Maintains positive attendance and commitment to lessons. Enthusiastic about Physics, particularly aviation and aircraft.' },
      { att:'full', e:[E4,G,G,A], a:[A,G,G,A,G], c:'Answers are too generalised and lack sufficient depth; surface-level recall rather than deeper understanding.', k:'Use question-led revision to deepen understanding.', g:'Regularly asks thought-provoking questions and demonstrates a strong desire to learn.' },
      { att:'full', e:[E4,G,E4,G], a:[G,G,E4,A,E4], c:'Poor use of scientific vocabulary in written answers. Formulae retention inconsistent.', k:'Practise retrieval of key formulae each session.', g:'Made notable progress in Electricity. Shows strong understanding when concepts are revisited and consolidated.' },
      { att:'partial', e:[G,A,G,A], a:[A,A,G,A,G], c:'Fatigue, particularly in the mornings, attributed to sleep difficulties and medication side effects.', k:'Keep sessions practical and active where possible.', g:'Still engaged despite tiredness. Good social conduct and shares positive experiences about family life.' },
      { att:'full', e:[E4,G,E4,G], a:[G,G,E4,G,E4], c:'Application of knowledge to unfamiliar and examination-style questions.', k:'Complete topic-based past paper questions weekly.', g:'Performed well in mock examination assessments. Responds well to structured revision and reinforcement activities.' },
      { att:'full', e:[E4,G,E4,G], a:[G,E4,E4,G,E4], c:'Presentation and legibility of written work remains a recurring concern. Needs independent revision habits.', k:'Establish short independent revision sessions between lessons.', g:'Strong engagement and understanding when studying Nuclear Physics. Notable progress in Electricity, Mechanics and Nuclear Physics.' },
    ]),
  ];
  return out.map((r) => ({ ...r, studentName: name }));
}
