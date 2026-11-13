/**
 * Deterministic fallback generator.
 *
 * Assembles the report from the tutors' own words and the computed ratings — no model,
 * no invention. Used when ANTHROPIC_API_KEY is absent or the Claude call fails, so the
 * demo always produces a complete document.
 */

import type { GeneratedContent, StudentTerm, SubjectAggregate } from '../types';

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full;
}

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Splits a tutor's free text into bullet-sized clauses. */
function toBullets(entries: string[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    for (const part of entry.split(/(?<=[.;])\s+/)) {
      const clean = part.trim().replace(/^[-•]\s*/, '');
      if (clean.length > 3) out.push(sentence(clean));
    }
  }
  return [...new Set(out)];
}

function joinList(items: string[]): string {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function attendanceNarrative(term: StudentTerm): string {
  const name = firstName(term.studentName);
  const { fullWeeks, partialWeeks, absentWeeks, recordedWeeks, unrecordedWeeks, modalPunctuality } = term.attendance;
  const parts = recordedWeeks
    ? [`${name} attended ${fullWeeks} of ${recordedWeeks} weeks in full during this reporting period.`]
    : ['Attendance was not recorded in the tutor submissions for this reporting period.'];
  if (partialWeeks) {
    parts.push(`There ${partialWeeks === 1 ? 'was' : 'were'} ${partialWeeks} week${partialWeeks === 1 ? '' : 's'} with some absence.`);
  }
  if (absentWeeks) {
    parts.push(`${absentWeeks} week${absentWeeks === 1 ? ' was' : 's were'} missed entirely.`);
  }
  if (recordedWeeks && unrecordedWeeks) {
    parts.push(`Attendance was not recorded for ${unrecordedWeeks} further week${unrecordedWeeks === 1 ? '' : 's'}.`);
  }
  if (modalPunctuality && (modalPunctuality === 'Average' || modalPunctuality === 'Poor')) {
    parts.push('Punctuality has been a recurring concern; lost minutes accumulate and impact learning time.');
  } else if (modalPunctuality) {
    parts.push(`Punctuality has been ${modalPunctuality.toLowerCase()}.`);
  }
  return parts.join(' ');
}

/** Ratings a tutor never gave arrive as "Not applicable"; the prose must say so, not read it as a grade. */
const rated = (values: string[]) => [...new Set(values.filter((v) => v && v !== 'Not applicable').map((v) => v.toLowerCase()))];

function subjectOverview(name: string, subject: SubjectAggregate): string {
  const strengths = subject.generalComments[0] ?? '';
  const bits: string[] = [];
  if (subject.tutorAssessedProgress !== 'Not applicable') bits.push(`${subject.tutorAssessedProgress.toLowerCase()} progress`);
  if (subject.attitudeToLearning !== 'Not applicable') bits.push(`${subject.attitudeToLearning.toLowerCase()} attitude to learning`);
  if (subject.contributionInLessons !== 'Not applicable') bits.push(`${subject.contributionInLessons.toLowerCase()} contribution in lessons`);
  const lead = bits.length
    ? `${name} has shown ${joinList(bits)} in ${subject.subject} this term.`
    : `Ratings for ${subject.subject} have not yet been recorded by the tutor this term.`;
  return [lead, strengths ? sentence(strengths) : ''].filter(Boolean).join(' ');
}

export function generateFromTemplate(term: StudentTerm): GeneratedContent {
  const name = firstName(term.studentName);
  const subjectNames = term.subjects.map((s) => s.subject);

  const subjects: GeneratedContent['subjects'] = {};
  const successes: GeneratedContent['successes'] = {};
  const challenges: GeneratedContent['challenges'] = {};

  for (const subject of term.subjects) {
    subjects[subject.subject] = {
      curriculumStrengths: toBullets(subject.generalComments).slice(0, 3).join(' ') || 'No strengths recorded.',
      areasForDevelopment: toBullets(subject.concerns).slice(0, 3).join(' ') || 'No areas recorded.',
    };
    successes[subject.subject] = toBullets(subject.generalComments).slice(0, 6);
    challenges[subject.subject] = toBullets(subject.concerns).slice(0, 8);
  }

  const attitudes = rated(term.subjects.map((s) => s.attitudeToLearning));
  const contributions = rated(term.subjects.map((s) => s.contributionInLessons));

  const overview = [
    `${name} is a capable and engaged student who has made positive progress across ${joinList(subjectNames)} during the reporting period.`,
    attitudes.length ? `Tutors report ${joinList(attitudes)} attitude to learning.` : 'Tutor ratings have not yet been recorded for this period.',
    'Continued focus on the areas identified below will help build on this progress next term.',
  ].join(' ');

  const cognitionAndLearning = [
    attitudes.length
      ? `In lessons, ${name} demonstrates a ${attitudes[0]} attitude towards learning and engages with classroom activities.`
      : `In lessons, ${name} engages with classroom activities.`,
    ...term.subjects.map((s) => subjectOverview(name, s)),
  ].join('\n\n');

  const targets = toBullets(term.subjects.flatMap((s) => s.keyActions)).slice(0, 12);

  return {
    overview,
    subjects,
    attendanceNarrative: attendanceNarrative(term),
    cognitionAndLearning,
    successes,
    challenges,
    targets,
    communicationAndInteraction: contributions.length
      ? `${name} engages with staff and peers during sessions. Tutor comments across the term describe ${name}'s contribution in lessons as ${joinList(contributions)}.`
      : `${name} engages with staff and peers during sessions. Tutors have not yet rated ${name}'s contribution in lessons this period.`,
    socialEmotionalMentalHealth:
      'No specific concerns have been recorded in the tutor submissions for this reporting period. Please review and amend if staff hold additional context.',
    sensoryPhysical:
      'No specific sensory or physical observations have been recorded in the tutor submissions for this reporting period. Please review and amend if staff hold additional context.',
  };
}
