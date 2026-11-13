/**
 * Rolls weekly submissions up into one StudentTerm per student.
 *
 * The Microsoft Form was never designed to feed this report, so the four rating columns
 * of the subject matrix are *heuristics* over the two Likert grids. Every derived value
 * is surfaced in the UI as editable — see DERIVATION_NOTES for the wording shown to staff.
 */

import { RATING_SCORE, bandRating } from './formSchema';
import { studentKey } from './parse';
import type {
  AttendanceAggregate,
  AttendanceWeek,
  AttendanceWeekSummary,
  Rating,
  StudentTerm,
  SubjectAggregate,
  WeeklySubmission,
} from './types';

export const DERIVATION_NOTES: Record<string, string> = {
  attitudeToLearning: 'Mean of Preparation for Class, Homework completion and Acts on feedback',
  behaviourForLearning: 'Mean of Punctuality and Attendance (engagement grid)',
  contributionInLessons: 'Mean of Quality of work and Understands key terms',
  tutorAssessedProgress: 'Trend of the academics grid across the term',
};

function mean(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function scoresFor(submissions: WeeklySubmission[], grid: 'engagement' | 'academics', row: string) {
  return submissions.map((s) => {
    const rating = (s[grid] as Record<string, Rating | undefined>)[row];
    return rating ? RATING_SCORE[rating] : null;
  });
}

function modal(values: (Rating | null)[]): Rating | null {
  const counts = new Map<Rating, number>();
  for (const v of values) {
    if (!v || v === 'Not applicable') continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (!counts.size) return null;
  // Ties resolve to the stronger rating, matching how staff describe a mixed term.
  const order: Rating[] = ['Excellent', 'Good', 'Average', 'Poor'];
  let best: Rating | null = null;
  let bestCount = -1;
  for (const rating of order) {
    const count = counts.get(rating) ?? 0;
    if (count > bestCount) {
      best = rating;
      bestCount = count;
    }
  }
  return best;
}

function nonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue; // tutors often repeat the same note week to week
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Progress band from the academics grid: compares the back half of the term to the front.
 * A rising or consistently strong picture reads as "Very good"; a weak or falling one as
 * "Needs support"; everything in between as "Developing".
 */
function progressBand(
  trend: { mean: number | null }[],
): 'Very good' | 'Developing' | 'Needs support' | 'Not applicable' {
  const points = trend.map((t) => t.mean).filter((m): m is number => m !== null);
  // No ratings at all is not "developing" — it is unrecorded.
  if (!points.length) return 'Not applicable';

  const overall = points.reduce((a, b) => a + b, 0) / points.length;
  const mid = Math.floor(points.length / 2);
  const first = points.slice(0, mid || 1);
  const second = points.slice(mid || 1);
  const firstMean = first.reduce((a, b) => a + b, 0) / first.length;
  const secondMean = second.length ? second.reduce((a, b) => a + b, 0) / second.length : firstMean;
  const delta = secondMean - firstMean;

  if (overall >= 3.4 || (overall >= 2.8 && delta >= 0.25)) return 'Very good';
  if (overall < 2.0 || (overall < 2.4 && delta <= -0.25)) return 'Needs support';
  return 'Developing';
}

function aggregateSubject(subject: string, submissions: WeeklySubmission[]): SubjectAggregate {
  const byWeek = [...submissions].sort((a, b) => a.weekBeginning.localeCompare(b.weekBeginning));

  const engagementMeans: SubjectAggregate['engagementMeans'] = {};
  for (const row of ['Attendance', 'Punctuality', 'Preparation for Class', 'Homework completion'] as const) {
    const m = mean(scoresFor(byWeek, 'engagement', row));
    if (m !== null) engagementMeans[row] = m;
  }

  const academicMeans: SubjectAggregate['academicMeans'] = {};
  for (const row of [
    'Meets Deadlines',
    'Quality of work',
    'Understands key terms',
    'Applies knowledge and understanding to new concepts',
    'Acts on feedback',
  ] as const) {
    const m = mean(scoresFor(byWeek, 'academics', row));
    if (m !== null) academicMeans[row] = m;
  }

  const academicTrend = byWeek.map((s) => ({
    weekBeginning: s.weekBeginning,
    mean: mean(Object.values(s.academics).map((r) => (r ? RATING_SCORE[r] : null))),
  }));

  return {
    subject,
    instructors: [...new Set(byWeek.map((s) => s.instructorName).filter(Boolean))],
    weekCount: new Set(byWeek.map((s) => s.weekBeginning)).size,
    firstWeek: byWeek[0]?.weekBeginning ?? '',
    lastWeek: byWeek[byWeek.length - 1]?.weekBeginning ?? '',
    attitudeToLearning: bandRating(
      mean([
        engagementMeans['Preparation for Class'] ?? null,
        engagementMeans['Homework completion'] ?? null,
        academicMeans['Acts on feedback'] ?? null,
      ]),
    ),
    behaviourForLearning: bandRating(
      mean([engagementMeans['Punctuality'] ?? null, engagementMeans['Attendance'] ?? null]),
    ),
    contributionInLessons: bandRating(
      mean([academicMeans['Quality of work'] ?? null, academicMeans['Understands key terms'] ?? null]),
    ),
    tutorAssessedProgress: progressBand(academicTrend),
    engagementMeans,
    academicMeans,
    academicTrend,
    concerns: nonEmpty(byWeek.map((s) => s.concerns)),
    keyActions: nonEmpty(byWeek.map((s) => s.keyActions)),
    generalComments: nonEmpty(byWeek.map((s) => s.generalComments)),
  };
}

function aggregateAttendance(submissions: WeeklySubmission[]): AttendanceAggregate {
  const weeks: AttendanceWeek[] = [...submissions]
    .sort((a, b) => a.weekBeginning.localeCompare(b.weekBeginning) || a.subject.localeCompare(b.subject))
    .map((s) => ({
      weekBeginning: s.weekBeginning,
      subject: s.subject,
      attendance: s.weeklyAttendance,
      punctuality: s.engagement['Punctuality'] ?? null,
    }));

  // A week counts as full only if every subject that week was full.
  const byWeek = new Map<string, AttendanceWeek[]>();
  for (const w of weeks) {
    const list = byWeek.get(w.weekBeginning) ?? [];
    list.push(w);
    byWeek.set(w.weekBeginning, list);
  }

  let fullWeeks = 0;
  let partialWeeks = 0;
  let absentWeeks = 0;
  let unrecordedWeeks = 0;
  const summary: AttendanceWeekSummary[] = [];

  for (const [weekBeginning, entries] of [...byWeek.entries()].sort()) {
    // A week counts only if at least one tutor recorded attendance for it.
    const known = entries.filter((e) => e.attendance);
    let attendance: AttendanceWeekSummary['attendance'];
    if (!known.length) {
      unrecordedWeeks += 1;
      attendance = 'unknown';
    } else if (known.every((e) => e.attendance === 'full')) {
      fullWeeks += 1;
      attendance = 'full';
    } else if (known.every((e) => e.attendance === 'none')) {
      absentWeeks += 1;
      attendance = 'none';
    } else {
      partialWeeks += 1;
      attendance = 'partial';
    }
    summary.push({
      weekBeginning,
      subjects: [...new Set(entries.map((e) => e.subject))].sort(),
      attendance,
      punctuality: modal(entries.map((e) => e.punctuality)),
    });
  }

  return {
    weeks,
    summary,
    distinctWeeks: byWeek.size,
    recordedWeeks: byWeek.size - unrecordedWeeks,
    fullWeeks,
    partialWeeks,
    absentWeeks,
    unrecordedWeeks,
    modalPunctuality: modal(weeks.map((w) => w.punctuality)),
  };
}

export function aggregateSubmissions(submissions: WeeklySubmission[]): StudentTerm[] {
  const byStudent = new Map<string, WeeklySubmission[]>();
  for (const s of submissions) {
    const key = studentKey(s.studentName);
    const list = byStudent.get(key) ?? [];
    list.push(s);
    byStudent.set(key, list);
  }

  const terms: StudentTerm[] = [];
  for (const [key, studentSubmissions] of byStudent) {
    const bySubject = new Map<string, WeeklySubmission[]>();
    for (const s of studentSubmissions) {
      const list = bySubject.get(s.subject) ?? [];
      list.push(s);
      bySubject.set(s.subject, list);
    }

    const sortedWeeks = studentSubmissions.map((s) => s.weekBeginning).sort();

    terms.push({
      id: key.replace(/[^a-z0-9]+/g, '-'),
      studentName: studentSubmissions[0].studentName,
      submissions: studentSubmissions,
      subjects: [...bySubject.entries()]
        .map(([subject, subs]) => aggregateSubject(subject, subs))
        .sort((a, b) => a.subject.localeCompare(b.subject)),
      attendance: aggregateAttendance(studentSubmissions),
      firstWeek: sortedWeeks[0] ?? '',
      lastWeek: sortedWeeks[sortedWeeks.length - 1] ?? '',
    });
  }

  return terms.sort((a, b) => a.studentName.localeCompare(b.studentName));
}

const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

/** "4 MAY TO 11 JUNE 2026" — the reporting date line on page 1. */
export function reportingDateLabel(firstWeek: string, lastWeek: string): string {
  if (!firstWeek || !lastWeek) return '';
  const a = new Date(firstWeek);
  const b = new Date(lastWeek);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}${sameYear ? '' : ` ${a.getUTCFullYear()}`}`;
  const right = `${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  return `${left} TO ${right}`;
}

/** Best guess at the UK academic year, e.g. "2025-2026". */
export function academicYearLabel(firstWeek: string): string {
  if (!firstWeek) return '';
  const d = new Date(firstWeek);
  const year = d.getUTCFullYear();
  // September onwards starts a new academic year.
  return d.getUTCMonth() >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

/** Best guess at the term from the first week's month. */
export function termLabel(firstWeek: string, lastWeek: string): string {
  if (!firstWeek) return '';
  const start = new Date(firstWeek);
  const end = new Date(lastWeek || firstWeek);
  const month = start.getUTCMonth();
  const name = month >= 8 && month <= 11 ? 'AUTUMN TERM' : month >= 0 && month <= 2 ? 'SPRING TERM' : 'SUMMER TERM';
  const span = `${MONTHS[start.getUTCMonth()].slice(0, 3)} - ${MONTHS[end.getUTCMonth()].slice(0, 3)} ${end.getUTCFullYear()}`;
  return `${name} (${span})`;
}
