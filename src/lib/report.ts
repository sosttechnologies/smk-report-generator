/** Builds the ReportDoc: joins computed aggregates, staff setup and generated prose. */

import { academicYearLabel, reportingDateLabel, termLabel } from './aggregate';
import type { GeneratedContent, MatrixRow, ReportDoc, ReportSetup, StudentTerm } from './types';

/** Prefills the setup panel from the data; staff confirm or correct before generating. */
export function defaultSetup(term: StudentTerm): ReportSetup {
  const tiers: Record<string, string> = {};
  const averageGrades: Record<string, string> = {};
  for (const subject of term.subjects) {
    tiers[subject.subject] = '';
    averageGrades[subject.subject] = 'n/a';
  }
  return {
    year: '',
    academicYear: academicYearLabel(term.firstWeek),
    termLabel: termLabel(term.firstWeek, term.lastWeek),
    reportingDateLabel: reportingDateLabel(term.firstWeek, term.lastWeek),
    tiers,
    averageGrades,
  };
}

/** "Sciences" + "Higher" -> "Sciences (Higher)", matching the reference report. */
export function subjectWithTier(subject: string, tier: string): string {
  const t = tier.trim();
  return t ? `${subject} (${t})` : subject;
}

export function buildMatrix(
  term: StudentTerm,
  setup: ReportSetup,
  content: GeneratedContent,
): MatrixRow[] {
  return term.subjects.map((subject) => {
    const generated = content.subjects[subject.subject];
    return {
      subject: subject.subject,
      tier: setup.tiers[subject.subject] ?? '',
      attitudeToLearning: subject.attitudeToLearning,
      behaviourForLearning: subject.behaviourForLearning,
      contributionInLessons: subject.contributionInLessons,
      curriculumStrengths: generated?.curriculumStrengths ?? '',
      curriculumAreasForDevelopment: generated?.areasForDevelopment ?? '',
      averageGrade: setup.averageGrades[subject.subject] || 'n/a',
      tutorAssessedProgress: subject.tutorAssessedProgress,
    };
  });
}

export function buildReport(
  term: StudentTerm,
  setup: ReportSetup,
  content: GeneratedContent,
  templateGenerated: boolean,
): ReportDoc {
  return {
    studentId: term.id,
    studentName: term.studentName,
    setup,
    matrix: buildMatrix(term, setup, content),
    content,
    attendance: term.attendance,
    templateGenerated,
    generatedAt: new Date().toISOString(),
  };
}
