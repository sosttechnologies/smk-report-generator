/**
 * Reads SMK's own weekly report documents without a model.
 *
 * Server-side twin of parseWeeklyReports() in artifact2/engine.js — keep the two in
 * step. Both documents SMK hold come from fixed templates, so every field sits under
 * a known label and can be found by matching, not by reading:
 *
 *   A. "WEEKLY PROGRESS REPORT"      — the Word report: STUDENT: / INSTRUCTOR: /
 *      SUBJECT: lines, a PERFORMANCE & ENGAGEMENT MATRIX of label→rating pairs,
 *      then headed sections (CURRICULUM PROGRESS & SUCCESSES, …).
 *   B. "SMK STUDENT PROGRESS REPORT" — the Microsoft Form printed to PDF: questions
 *      1–10, with the grids as rows of radio marks (● chosen, ○ not) under column
 *      headings EXCELLENT GOOD AVERAGE POOR [NOT APPLICABLE].
 *
 * Works on flat text (whitespace collapsed), which is what mammoth and pdf text
 * extraction both produce. One file may hold several reports; each title starts a
 * new one. Returns [] when the text is neither layout.
 */

import { canonicalSubject, studentKey } from './parse';
import type { AcademicRow, EngagementRow, Rating, WeeklyAttendance, WeeklySubmission } from './types';

const RATING_WORDS = '(Excellent|Very good|Good|Average|Satisfactory|Poor|Not applicable|N/?A)';
const CHOSEN = '[●◉⚫■☒☑✓✔]';
const MARK = '[●◉⚫■☒☑✓✔○◯⚪□☐]';

const DOC_ENGAGEMENT: Array<[string, EngagementRow]> = [
  ['Attendance', 'Attendance'],
  ['Punctuality', 'Punctuality'],
  ['Preparation for class', 'Preparation for Class'],
  ['Homework completion', 'Homework completion'],
];
const DOC_ACADEMICS: Array<[string, AcademicRow]> = [
  ['Meets deadlines', 'Meets Deadlines'],
  ['Quality of work', 'Quality of work'],
  ['Understands key terms', 'Understands key terms'],
  ['Applies knowledge (?:and understanding )?to new concepts', 'Applies knowledge and understanding to new concepts'],
  ['Acts on feedback', 'Acts on feedback'],
];

const HEADINGS = [
  /PERFORMANCE\s*&\s*ENGAGEMENT\s*MATRIX/i,
  /ATTENDANCE\s*&\s*PUNCTUALITY/i,
  /CURRICULUM\s*PROGRESS\s*&\s*SUCCESSES/i,
  /AREAS\s*FOR\s*DEVELOPMENT\s*&\s*CONCERNS/i,
  /TARGETS\s*OR\s*GOALS\s*&\s*KEY\s*ACTIONS/i,
  /SPECIAL\s*CONSIDERATIONS\s*&\s*ACCESS\s*ARRANGEMENTS/i,
  /INSTRUCTOR\s*GENERAL\s*COMMENTS/i,
  /SIGN-?OFF\s*&\s*VERIFICATION/i,
];

function ratingWord(w: string): Rating | null {
  const t = w.toLowerCase().replace(/[^a-z]/g, '');
  if (t === 'excellent') return 'Excellent';
  if (t === 'verygood' || t === 'good') return 'Good';
  if (t === 'average' || t === 'satisfactory') return 'Average';
  if (t === 'poor') return 'Poor';
  if (t === 'na' || t === 'notapplicable') return 'Not applicable';
  return null;
}

/** Text between a label and the nearest following heading (or the end). */
function between(flat: string, startRe: RegExp, endRes: RegExp[]): string {
  const m = flat.match(startRe);
  if (!m || m.index === undefined) return '';
  const from = m.index + m[0].length;
  let to = flat.length;
  for (const re of endRes) {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    r.lastIndex = from;
    const n = r.exec(flat);
    if (n && n.index < to) to = n.index;
  }
  return flat.slice(from, to).trim();
}

/** Repairs what text extraction loses: spaces after sentences, spaces before commas. */
function tidy(text: string | undefined): string {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([.!?:])(?=[A-Z])/g, '$1 ')
    .trim();
}

/** "• a • b" or "1. a 2. b" → clean items; a plain paragraph stays whole. */
function items(text: string): string[] {
  const t = tidy(text);
  if (!t) return [];
  const parts = t.includes('•') ? t.split('•') : t.split(/\s*(?=\b\d{1,2}\.\s+[A-Z])/);
  return parts.map((s) => s.replace(/^\d{1,2}\.\s*/, '').trim()).filter((s) => s.length > 2);
}

/** Joins list items into prose, so bullets do not run into one another. */
const prose = (list: string[]) => list.map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(' ');

const titleCase = (s: string) => tidy(s).replace(/\b([A-Z])([A-Z]+)\b/g, (_, f: string, r: string) => f + r.toLowerCase());
const stripLevel = (s: string) => tidy(s).replace(/^(GCSE|A[- ]LEVEL|KS[34]|IGCSE)\s+/i, '');

function attendanceFrom(text: string): WeeklyAttendance {
  const a = text.toLowerCase();
  if (/100\s*%|\bfull\b/.test(a)) return 'full';
  if (/(^|\D)0\s*%|did not attend|no attendance/.test(a)) return 'none';
  if (/absent|missed|partial|some day/.test(a)) return 'partial';
  return 'full';
}

function toMonday(d: Date): string {
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = u.getUTCDay();
  u.setUTCDate(u.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return u.toISOString().slice(0, 10);
}

function parseDmy(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : toMonday(d);
}

interface Fields {
  studentName: string;
  instructorName: string;
  subject: string;
  week: string;
  weeklyAttendance: WeeklyAttendance;
  engagement: WeeklySubmission['engagement'];
  academics: WeeklySubmission['academics'];
  concerns: string;
  keyActions: string;
  generalComments: string;
}

function finish(f: Fields): WeeklySubmission | null {
  const subject = canonicalSubject(stripLevel(f.subject));
  const weekBeginning = parseDmy(f.week);
  const studentName = titleCase(f.studentName);
  if (!studentName || !subject || !weekBeginning) return null;
  return {
    id: `${studentKey(studentName)}|${subject}|${weekBeginning}`,
    submittedAt: null,
    studentName,
    instructorName: titleCase(f.instructorName),
    subject,
    weekBeginning,
    weeklyAttendance: f.weeklyAttendance,
    engagement: f.engagement,
    academics: f.academics,
    concerns: f.concerns,
    keyActions: f.keyActions,
    generalComments: f.generalComments,
  };
}

/* Layout A — the headed Word report. */
function parseHeadedReport(flat: string): WeeklySubmission | null {
  const grab = (re: RegExp) => (flat.match(re)?.[1] ?? '').trim();
  const ratings = <K extends string>(pairs: Array<[string, K]>): Partial<Record<K, Rating>> => {
    const out: Partial<Record<K, Rating>> = {};
    for (const [label, key] of pairs) {
      const m = flat.match(new RegExp(`\\b${label}\\s+${RATING_WORDS}\\b`, 'i'));
      const v = m && ratingWord(m[1]);
      if (v && v !== 'Not applicable') out[key] = v;
    }
    return out;
  };
  const observations = grab(/Observations:\s*(.+?)(?:\s*CURRICULUM\s*PROGRESS|$)/i);
  const strengths = between(flat, /Strengths\s*&\s*Achievements:/i, HEADINGS);
  const access = between(flat, /(?:Assessment\s*Observations\s*&\s*Recommendations|Access\s*Arrangements):/i, HEADINGS);
  const general = between(flat, /INSTRUCTOR\s*GENERAL\s*COMMENTS/i, HEADINGS);

  return finish({
    studentName: grab(/STUDENT:\s*(.+?)\s*(?:INSTRUCTOR|TUTOR):/i),
    instructorName: grab(/(?:INSTRUCTOR|TUTOR):\s*(.+?)\s*SUBJECT:/i),
    subject: grab(/SUBJECT:\s*(.+?)\s*(?:ACADEMIC\s*YEAR|PERFORMANCE)/i),
    week: grab(/WEEK\s*(?:COMMENCING|BEGINNING)\s*:?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i),
    weeklyAttendance: attendanceFrom(grab(/Weekly\s*Attendance\s*Status:\s*(.+?)(?:\s*Observations:|\s*CURRICULUM|$)/i)),
    engagement: ratings(DOC_ENGAGEMENT),
    academics: ratings(DOC_ACADEMICS),
    concerns: prose(items(between(flat, /Key\s*Concerns:/i, HEADINGS))),
    keyActions: prose(items(between(flat, /(?:Agreed\s*Action\s*Plan|Key\s*Actions|Next\s*Steps):/i, HEADINGS))),
    generalComments: [
      prose(items(strengths)),
      tidy(general),
      observations ? `Attendance: ${tidy(observations)}` : '',
      access ? `Access arrangements: ${tidy(access)}` : '',
    ].filter(Boolean).join(' '),
  });
}

/* Layout B — the Microsoft Form printed to PDF, questions 1–10. */
function parseFormPrint(flat: string): WeeklySubmission | null {
  // Each question is found by its number; its answer runs to the next number.
  const after = (n: number): string => {
    const m = flat.match(new RegExp(`\\b${n}\\.\\s*[A-Z][A-Z &/()'-]*?[A-Z)]\\s+(?=[^A-Z]|[A-Z][a-z]|[●○◉◯⚫⚪■□☒☐✓✔]|\\d|EXCELLENT)`));
    if (!m || m.index === undefined) return '';
    const from = m.index + m[0].length;
    const stop = flat.slice(from).search(new RegExp(`\\b${n + 1}\\.\\s*[A-Z][A-Z &/()]+(?:\\s|$)`));
    return flat.slice(from, stop === -1 ? flat.length : from + stop).trim();
  };
  const grid = <K extends string>(text: string, pairs: Array<[string, K]>): Partial<Record<K, Rating>> => {
    const cols: Rating[] = [];
    for (const w of text.match(/\b(EXCELLENT|VERY GOOD|GOOD|AVERAGE|POOR|NOT APPLICABLE|N\/A)\b/g) ?? []) {
      const r = ratingWord(w);
      if (r && !cols.includes(r)) cols.push(r);
    }
    const out: Partial<Record<K, Rating>> = {};
    for (const [label, key] of pairs) {
      const m = text.match(new RegExp(`\\b${label}\\s+((?:${MARK}\\s*)+)`, 'i'));
      if (!m) continue;
      const marks = m[1].match(new RegExp(MARK, 'g')) ?? [];
      const idx = marks.findIndex((c) => new RegExp(CHOSEN).test(c));
      const v = idx >= 0 ? cols[idx] : null;
      if (v && v !== 'Not applicable') out[key] = v;
    }
    return out;
  };
  const chosen = after(5).match(new RegExp(`${CHOSEN}\\s*([^●◉⚫■☒☑✓✔○◯⚪□☐]+)`));

  return finish({
    studentName: after(1),
    instructorName: after(2),
    subject: after(3),
    week: (after(4).match(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/) ?? [''])[0],
    weeklyAttendance: attendanceFrom(chosen ? chosen[1] : ''),
    engagement: grid(after(6), DOC_ENGAGEMENT),
    academics: grid(after(7), DOC_ACADEMICS),
    concerns: prose(items(after(8))),
    keyActions: prose(items(after(9))),
    generalComments: tidy(after(10)),
  });
}

export function parseWeeklyReports(rawText: string): WeeklySubmission[] {
  const flat = rawText
    .replace(/\s+/g, ' ')
    // Running page headers and footers of the printed form.
    .replace(/SMK Student Progress Report\b[^●○]*?Page \d+/g, ' ')
    .trim();
  const out: WeeklySubmission[] = [];
  const seen = new Set<string>();
  const push = (s: WeeklySubmission | null) => {
    if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); }
  };
  if (/\bSMK STUDENT PROGRESS REPORT\b/.test(flat) && /\b1\.\s*STUDENT NAME\b/i.test(flat)) {
    for (const chunk of flat.split(/(?=\bSMK STUDENT PROGRESS REPORT\b)/)) {
      if (/\b1\.\s*STUDENT NAME\b/i.test(chunk)) push(parseFormPrint(chunk));
    }
  }
  // The Word title can be glued to the next heading ("…REPORTREPORTING WEEK").
  if (/\bWEEKLY PROGRESS REPORT/.test(flat) && /\bSTUDENT:/i.test(flat)) {
    for (const chunk of flat.split(/(?=\bWEEKLY PROGRESS REPORT)/)) {
      if (/\bSTUDENT:/i.test(chunk)) push(parseHeadedReport(chunk));
    }
  }
  return out;
}

/** True when the text looks like either SMK layout, even if a field is missing. */
export const looksLikeWeeklyReport = (text: string): boolean =>
  /\bSMK STUDENT PROGRESS REPORT\b|\bWEEKLY PROGRESS REPORT/.test(text.replace(/\s+/g, ' '));
