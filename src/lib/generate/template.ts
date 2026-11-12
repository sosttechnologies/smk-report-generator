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
  const { fullWeeks, partialWeeks, absentWeeks, distinctWeeks, modalPunctuality } = term.attendance;
  const parts = [`${name} attended ${fullWeeks} of ${distinctWeeks} weeks in full during this reporting period.`];
  if (partialWeeks) {
    parts.push(`There ${partialWeeks === 1 ? 'was' : 'were'} ${partialWeeks} week${partialWeeks === 1 ? '' : 's'} with some absence.`);
  }
  if (absentWeeks) {
    parts.push(`${absentWeeks} week${absentWeeks === 1 ? ' was' : 's were'} missed entirely.`);
  }
  if (modalPunctuality && (modalPunctuality === 'Average' || modalPunctuality === 'Poor')) {
    parts.push('Punctuality has been a recurring concern; lost minutes accumulate and impact learning time.');
  } else if (modalPunctuality) {
    parts.push(`Punctuality has been ${modalPunctuality.toLowerCase()}.`);
  }
  return parts.join(' ');
}

function subjectOverview(name: string, subject: SubjectAggregate): string {
  const strengths = subject.generalComments[0] ?? '';
  return [
    `${name} has shown ${subject.tutorAssessedProgress.toLowerCase()} progress in ${subject.subject} this term,`,
    `with ${subject.attitudeToLearning.toLowerCase()} attitude to learning and ${subject.contributionInLessons.toLowerCase()} contribution in lessons.`,
    strengths ? sentence(strengths) : '',
  ]
    .filter(Boolean)
    .join(' ');
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

  const overview = [
    `${name} is a capable and engaged student who has made positive progress across ${joinList(subjectNames)} during the reporting period.`,
    `Tutors report ${joinList([...new Set(term.subjects.map((s) => s.attitudeToLearning.toLowerCase()))])} attitude to learning.`,
    'Continued focus on the areas identified below will help build on this progress next term.',
  ].join(' ');

  const cognitionAndLearning = [
    `In lessons, ${name} demonstrates a ${term.subjects[0]?.attitudeToLearning.toLowerCase() ?? 'positive'} attitude towards learning and engages with classroom activities.`,
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
    communicationAndInteraction: `${name} engages with staff and peers during sessions. Tutor comments across the term describe ${name}'s contribution in lessons as ${joinList([...new Set(term.subjects.map((s) => s.contributionInLessons.toLowerCase()))])}.`,
    socialEmotionalMentalHealth:
      'No specific concerns have been recorded in the tutor submissions for this reporting period. Please review and amend if staff hold additional context.',
    sensoryPhysical:
      'No specific sensory or physical observations have been recorded in the tutor submissions for this reporting period. Please review and amend if staff hold additional context.',
  };
}
