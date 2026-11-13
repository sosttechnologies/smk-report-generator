/**
 * Canonical schema for the "SMK STUDENT PROGRESS REPORT" Microsoft Form.
 *
 * Tutors complete one submission per student, per subject, per week. Microsoft Forms
 * exports Likert grids as one column per row-item, usually headed
 * `STUDENT ENGAGEMENT [Punctuality]` — but the exact spelling drifts between exports,
 * so every field carries a list of aliases and headers are normalised before matching.
 */

import { ACADEMIC_ROWS, ENGAGEMENT_ROWS, type Rating, type WeeklyAttendance } from './types';

/** Lowercase, collapse whitespace, drop punctuation that varies between exports. */
export function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[[\]().:*?/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FieldSpec {
  key: string;
  /** Normalised aliases; the first is the canonical form question text. */
  aliases: string[];
  required: boolean;
}

export const SCALAR_FIELDS: FieldSpec[] = [
  { key: 'studentName', aliases: ['student name', 'student', 'name of student', 'pupil name'], required: true },
  {
    key: 'instructorName',
    // "INSTRUCTURE NAME" is the live form's spelling; accept the correct one too.
    aliases: ['instructure name', 'instructor name', 'tutor name', 'tutor', 'instructor', 'teacher name'],
    required: false,
  },
  { key: 'subject', aliases: ['subject', 'subject taught'], required: false },
  {
    key: 'weekBeginning',
    aliases: ['reporting week week beginning', 'reporting week', 'week beginning', 'week commencing'],
    required: false,
  },
  { key: 'weeklyAttendance', aliases: ['weekly attendance', 'attendance for the week'], required: false },
  // Forms stamps every response; it stands in for the week when a tutor left Q4 blank.
  {
    key: 'submittedAt',
    aliases: ['completion time', 'start time', 'last modified time', 'timestamp', 'submitted'],
    required: false,
  },
  { key: 'concerns', aliases: ['concerns', 'areas of concern'], required: false },
  { key: 'keyActions', aliases: ['key actions', 'actions', 'next steps'], required: false },
  {
    key: 'generalComments',
    aliases: ['general comments', 'comments', 'general comments examples include praising positive attitudes'],
    required: false,
  },
];

/** Metadata columns Microsoft Forms adds; recognised so they aren't reported as unmapped. */
export const METADATA_ALIASES = ['id', 'email', 'name'];

/**
 * Grid columns. A header matches when it contains the grid prefix AND the row label,
 * or when it is just the row label (some exports drop the question prefix).
 */
export const GRID_SPECS = [
  { grid: 'engagement' as const, prefixes: ['student engagement', 'engagement'], rows: ENGAGEMENT_ROWS },
  { grid: 'academics' as const, prefixes: ['academics', 'academic'], rows: ACADEMIC_ROWS },
];

/** Row-label aliases, because grid labels get abbreviated in exports. */
export const ROW_ALIASES: Record<string, string[]> = {
  Attendance: ['attendance'],
  Punctuality: ['punctuality'],
  'Preparation for Class': ['preparation for class', 'preparation', 'prep for class'],
  'Homework completion': ['homework completion', 'homework'],
  'Meets Deadlines': ['meets deadlines', 'deadlines'],
  'Quality of work': ['quality of work', 'work quality'],
  'Understands key terms': ['understands key terms', 'key terms'],
  'Applies knowledge and understanding to new concepts': [
    'applies knowledge and understanding to new concepts',
    'applies knowledge to new concepts',
    'applies knowledge',
    'application of knowledge',
  ],
  'Acts on feedback': ['acts on feedback', 'feedback'],
};

const RATING_LOOKUP: Record<string, Rating> = {
  excellent: 'Excellent',
  good: 'Good',
  average: 'Average',
  poor: 'Poor',
  'not applicable': 'Not applicable',
  'n a': 'Not applicable',
  na: 'Not applicable',
};

export function parseRating(value: unknown): Rating | null {
  if (value === null || value === undefined) return null;
  const key = normaliseHeader(String(value));
  if (!key) return null;
  return RATING_LOOKUP[key] ?? null;
}

export function parseWeeklyAttendance(value: unknown): WeeklyAttendance | null {
  if (value === null || value === undefined) return null;
  const text = normaliseHeader(String(value));
  if (!text) return null;
  if (text.startsWith('100')) return 'full';
  if (text.startsWith('0')) return 'none';
  if (text.includes('absent')) return 'partial';
  return null;
}

/** Numeric weight of a rating; `Not applicable` is excluded from means. */
export const RATING_SCORE: Record<Rating, number | null> = {
  Excellent: 4,
  Good: 3,
  Average: 2,
  Poor: 1,
  'Not applicable': null,
};

/** Band a mean score back to a word for the subject matrix. */
export function bandRating(mean: number | null): Rating {
  if (mean === null || Number.isNaN(mean)) return 'Not applicable';
  if (mean >= 3.5) return 'Excellent';
  if (mean >= 2.5) return 'Good';
  if (mean >= 1.5) return 'Average';
  return 'Poor';
}
