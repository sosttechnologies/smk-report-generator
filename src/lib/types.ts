/** Shared types for the SMK Gateway termly report generator. */

export type Rating = 'Excellent' | 'Good' | 'Average' | 'Poor' | 'Not applicable';

/** Q5 — WEEKLY ATTENDANCE. */
export type WeeklyAttendance = 'full' | 'none' | 'partial';

/** Q6 — STUDENT ENGAGEMENT grid rows. */
export const ENGAGEMENT_ROWS = [
  'Attendance',
  'Punctuality',
  'Preparation for Class',
  'Homework completion',
] as const;
export type EngagementRow = (typeof ENGAGEMENT_ROWS)[number];

/** Q7 — ACADEMICS grid rows. */
export const ACADEMIC_ROWS = [
  'Meets Deadlines',
  'Quality of work',
  'Understands key terms',
  'Applies knowledge and understanding to new concepts',
  'Acts on feedback',
] as const;
export type AcademicRow = (typeof ACADEMIC_ROWS)[number];

/** One row of the Microsoft Forms export: a single tutor, subject and week. */
export interface WeeklySubmission {
  id: string;
  submittedAt: string | null;
  studentName: string;
  instructorName: string;
  subject: string;
  /** ISO date of the Monday the week begins. */
  weekBeginning: string;
  weeklyAttendance: WeeklyAttendance;
  engagement: Partial<Record<EngagementRow, Rating>>;
  academics: Partial<Record<AcademicRow, Rating>>;
  concerns: string;
  keyActions: string;
  generalComments: string;
}

/** Problems found while parsing an upload, surfaced to staff rather than thrown away. */
export interface ParseIssue {
  row: number;
  field: string;
  message: string;
}

export interface ParseResult {
  submissions: WeeklySubmission[];
  issues: ParseIssue[];
  /** Headers in the file we could not map to a known question. */
  unmappedHeaders: string[];
}

/** Computed roll-up for one subject across every week of the term. */
export interface SubjectAggregate {
  subject: string;
  instructors: string[];
  weekCount: number;
  firstWeek: string;
  lastWeek: string;
  /** Derived matrix columns — all overridable by staff. */
  attitudeToLearning: Rating;
  behaviourForLearning: Rating;
  contributionInLessons: Rating;
  tutorAssessedProgress: 'Very good' | 'Developing' | 'Needs support';
  engagementMeans: Partial<Record<EngagementRow, number>>;
  academicMeans: Partial<Record<AcademicRow, number>>;
  /** Mean of the academics grid, week by week, used for the progress trend. */
  academicTrend: { weekBeginning: string; mean: number | null }[];
  concerns: string[];
  keyActions: string[];
  generalComments: string[];
}

export interface AttendanceWeek {
  weekBeginning: string;
  subject: string;
  attendance: WeeklyAttendance;
  punctuality: Rating | null;
}

/** One row of the summarised attendance table in the report. */
export interface AttendanceWeekSummary {
  weekBeginning: string;
  subjects: string[];
  attendance: WeeklyAttendance;
  punctuality: Rating | null;
}

export interface AttendanceAggregate {
  /** Raw rows, one per subject per week — shown in the app, not the report. */
  weeks: AttendanceWeek[];
  /** One row per week — this is what the report prints. */
  summary: AttendanceWeekSummary[];
  /** Distinct weeks, not submissions. */
  distinctWeeks: number;
  fullWeeks: number;
  partialWeeks: number;
  absentWeeks: number;
  modalPunctuality: Rating | null;
}

/** Everything known about one student for one term, before any text generation. */
export interface StudentTerm {
  id: string;
  studentName: string;
  submissions: WeeklySubmission[];
  subjects: SubjectAggregate[];
  attendance: AttendanceAggregate;
  firstWeek: string;
  lastWeek: string;
}

/** Staff-entered values the Microsoft Form does not capture. */
export interface ReportSetup {
  year: string;
  academicYear: string;
  termLabel: string;
  reportingDateLabel: string;
  /** subject -> tier, e.g. "Higher". Blank means no tier shown. */
  tiers: Record<string, string>;
  /** subject -> average score/grade on tests and mocks. Defaults to "n/a". */
  averageGrades: Record<string, string>;
}

export interface MatrixRow {
  subject: string;
  tier: string;
  attitudeToLearning: string;
  behaviourForLearning: string;
  contributionInLessons: string;
  curriculumStrengths: string;
  curriculumAreasForDevelopment: string;
  averageGrade: string;
  tutorAssessedProgress: string;
}

/** The generated prose, keyed to the named sections of the real report. */
export interface GeneratedContent {
  overview: string;
  subjects: Record<string, { curriculumStrengths: string; areasForDevelopment: string }>;
  attendanceNarrative: string;
  cognitionAndLearning: string;
  successes: Record<string, string[]>;
  challenges: Record<string, string[]>;
  targets: string[];
  communicationAndInteraction: string;
  socialEmotionalMentalHealth: string;
  sensoryPhysical: string;
}

export type ReportStatus = 'none' | 'generating' | 'draft' | 'approved' | 'exported';

export interface ReportDoc {
  studentId: string;
  studentName: string;
  setup: ReportSetup;
  matrix: MatrixRow[];
  content: GeneratedContent;
  attendance: AttendanceAggregate;
  /** True when the Claude call was unavailable or failed and the template was used. */
  templateGenerated: boolean;
  generatedAt: string;
}
