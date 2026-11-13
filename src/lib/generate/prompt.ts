/**
 * The prompt and the response contract, shared by every provider.
 *
 * Kept in one place so Claude and an open-weight model are asked for exactly the
 * same thing and judged against exactly the same schema — otherwise a comparison
 * between them measures the prompt, not the model.
 */

import type { GeneratedContent, StudentTerm } from '../types';

export const SYSTEM_PROMPT = `You write termly progress reports for SMK Gateway (SIEVEMK Gateway), a UK education charity in Milton Keynes providing tutoring to students aged 11 and over.

Voice: warm, professional, specific. Third person. British spelling throughout ("analysing", "behaviour", "organised", "practise" as a verb).

Absolute rules:
- Use ONLY facts present in the tutor submissions you are given. Never invent an achievement, a grade, a diagnosis, a family circumstance or a concern.
- Where the submissions contain no information for a section, say so plainly and suggest staff review it. Do not pad.
- Never speculate about medical, psychological or safeguarding matters. If a tutor mentions fatigue, medication or similar, report it only as the tutor described it.
- The student is identified only as "Student A" and tutors as "Tutor 1", "Tutor 2". Use those names exactly as given; never guess a real name.
- These are reports about children, read by their families. Be constructive about difficulties; never dismissive or alarming.`;

export function buildReportPrompt(term: StudentTerm): string {
  const lines: string[] = [];

  lines.push(`STUDENT: ${term.studentName}`);
  lines.push(`REPORTING PERIOD: week beginning ${term.firstWeek} to week beginning ${term.lastWeek}`);
  lines.push('');
  lines.push('ATTENDANCE (computed from the weekly forms — do not contradict these figures):');
  lines.push(
    `- ${term.attendance.fullWeeks} of ${term.attendance.distinctWeeks} weeks attended in full; ` +
      `${term.attendance.partialWeeks} week(s) with some absence; ${term.attendance.absentWeeks} week(s) missed entirely.`,
  );
  lines.push(`- Most common punctuality rating: ${term.attendance.modalPunctuality ?? 'not recorded'}`);
  lines.push('');

  for (const subject of term.subjects) {
    const tutors = subject.instructors.join(', ') || 'not recorded';
    lines.push(`SUBJECT: ${subject.subject} (tutor${subject.instructors.length > 1 ? 's' : ''}: ${tutors}, ${subject.weekCount} weeks)`);
    lines.push(
      `  Derived ratings — attitude to learning: ${subject.attitudeToLearning}; ` +
        `behaviour for learning: ${subject.behaviourForLearning}; ` +
        `contribution in lessons: ${subject.contributionInLessons}; ` +
        `tutor assessed progress: ${subject.tutorAssessedProgress}`,
    );
    lines.push('  Weekly general comments:');
    subject.generalComments.forEach((c) => lines.push(`   - ${c}`));
    lines.push('  Weekly concerns:');
    subject.concerns.forEach((c) => lines.push(`   - ${c}`));
    lines.push('  Weekly key actions:');
    subject.keyActions.forEach((c) => lines.push(`   - ${c}`));
    lines.push('');
  }

  const keys = term.subjects.map((s) => s.subject);

  lines.push("Write this student's Interim Termly Report as a single JSON object with exactly this shape:");
  lines.push('{');
  lines.push('  "overview": "2-3 sentences introducing progress this term, naming the subjects studied",');
  lines.push('  "subjects": {');
  lines.push(keys.map((k) => `    ${JSON.stringify(k)}: { "curriculumStrengths": "short phrase, as in a table cell", "areasForDevelopment": "short phrase, as in a table cell" }`).join(',\n'));
  lines.push('  },');
  lines.push('  "attendanceNarrative": "2-3 sentences, consistent with the figures above",');
  lines.push('  "cognitionAndLearning": "4-6 paragraphs separated by \\n\\n, covering engagement and progress in each subject",');
  lines.push('  "successes": {');
  lines.push(keys.map((k) => `    ${JSON.stringify(k)}: ["4-6 short bullet points of what went well"]`).join(',\n'));
  lines.push('  },');
  lines.push('  "challenges": {');
  lines.push(keys.map((k) => `    ${JSON.stringify(k)}: ["3-8 short bullet points of difficulties, phrased constructively"]`).join(',\n'));
  lines.push('  },');
  lines.push('  "targets": ["6-12 short actionable targets drawn from the key actions"],');
  lines.push('  "communicationAndInteraction": "2-3 sentences, based only on the comments",');
  lines.push('  "socialEmotionalMentalHealth": "1-3 sentences; if nothing is recorded, say so",');
  lines.push('  "sensoryPhysical": "1-3 sentences; only what tutors reported, otherwise say none identified"');
  lines.push('}');
  lines.push('');
  lines.push('Return the JSON object and nothing else. No preamble, no code fence, no commentary.');

  return lines.join('\n');
}

const str = (v: unknown): string => (typeof v === 'string' && v.trim() ? v.trim() : '');
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/**
 * Narrows a model's JSON to GeneratedContent.
 *
 * Throws rather than patching gaps: a half-filled report is worse than a clean
 * fallback, because a missing section is easy for a tired member of staff to miss.
 */
export function validateContent(raw: unknown, term: StudentTerm): GeneratedContent {
  if (!raw || typeof raw !== 'object') throw new Error('Response was not a JSON object');
  const o = raw as Record<string, unknown>;

  const required = ['overview', 'attendanceNarrative', 'cognitionAndLearning', 'communicationAndInteraction', 'socialEmotionalMentalHealth', 'sensoryPhysical'] as const;
  const missing = required.filter((k) => !str(o[k]));
  if (missing.length) throw new Error(`Response was missing: ${missing.join(', ')}`);

  const rawSubjects = (o.subjects ?? {}) as Record<string, { curriculumStrengths?: unknown; areasForDevelopment?: unknown }>;
  const rawSuccesses = (o.successes ?? {}) as Record<string, unknown>;
  const rawChallenges = (o.challenges ?? {}) as Record<string, unknown>;

  const subjects: GeneratedContent['subjects'] = {};
  const successes: GeneratedContent['successes'] = {};
  const challenges: GeneratedContent['challenges'] = {};
  const missingSubjects: string[] = [];

  for (const subject of term.subjects) {
    const key = subject.subject;
    const strengths = str(rawSubjects[key]?.curriculumStrengths);
    const areas = str(rawSubjects[key]?.areasForDevelopment);
    if (!strengths || !areas) missingSubjects.push(key);
    subjects[key] = { curriculumStrengths: strengths, areasForDevelopment: areas };
    successes[key] = arr(rawSuccesses[key]);
    challenges[key] = arr(rawChallenges[key]);
  }
  if (missingSubjects.length) throw new Error(`No subject detail returned for: ${missingSubjects.join(', ')}`);

  const targets = arr(o.targets);
  if (!targets.length) throw new Error('Response contained no targets');

  return {
    overview: str(o.overview),
    subjects,
    attendanceNarrative: str(o.attendanceNarrative),
    cognitionAndLearning: str(o.cognitionAndLearning),
    successes,
    challenges,
    targets,
    communicationAndInteraction: str(o.communicationAndInteraction),
    socialEmotionalMentalHealth: str(o.socialEmotionalMentalHealth),
    sensoryPhysical: str(o.sensoryPhysical),
  };
}
