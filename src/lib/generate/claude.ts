/**
 * Claude drafting for the termly report.
 *
 * Runs server-side only. The prompt is built from the tutors' submissions and the
 * computed aggregates; the model is told to use nothing else. The response shape is
 * enforced with structured outputs (a Zod schema built per student, because the subject
 * keys differ), so a malformed reply cannot reach the document.
 *
 * Any failure — no key, refusal, network, unparseable output — falls back to the
 * deterministic template in ./template.ts rather than showing staff half a report.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { GeneratedContent, StudentTerm } from '../types';

const MODEL = 'claude-opus-5';

const SYSTEM = `You write termly progress reports for SMK Gateway (SIEVEMK Gateway), a UK education charity in Milton Keynes providing tutoring to students aged 11 and over.

Voice: warm, professional, specific. Third person. British spelling throughout ("analysing", "behaviour", "organised", "practise" as a verb).

Absolute rules:
- Use ONLY facts present in the tutor submissions you are given. Never invent an achievement, a grade, a diagnosis, a family circumstance or a concern.
- Where the submissions contain no information for a section, say so plainly and suggest staff review it. Do not pad.
- Never speculate about medical, psychological or safeguarding matters. If a tutor mentions fatigue, medication or similar, report it only as the tutor described it.
- These are reports about children, read by their families. Be constructive about difficulties; never dismissive or alarming.`;

/** The subject keys differ per student, so the schema is built per request. */
function buildSchema(subjects: string[]) {
  const subjectDetail = z.object({
    curriculumStrengths: z.string(),
    areasForDevelopment: z.string(),
  });

  const perSubject = <T extends z.ZodTypeAny>(value: T) =>
    z.object(Object.fromEntries(subjects.map((s) => [s, value])) as Record<string, T>);

  return z.object({
    overview: z.string(),
    subjects: perSubject(subjectDetail),
    attendanceNarrative: z.string(),
    cognitionAndLearning: z.string(),
    successes: perSubject(z.array(z.string())),
    challenges: perSubject(z.array(z.string())),
    targets: z.array(z.string()),
    communicationAndInteraction: z.string(),
    socialEmotionalMentalHealth: z.string(),
    sensoryPhysical: z.string(),
  });
}

function buildPrompt(term: StudentTerm): string {
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

  lines.push('Write this student\'s Interim Termly Report. Guidance per field:');
  lines.push('- overview: 2-3 sentences introducing progress this term, naming the subjects studied.');
  lines.push('- subjects[x].curriculumStrengths / areasForDevelopment: short phrases, as they appear in a table cell.');
  lines.push('- attendanceNarrative: 2-3 sentences, consistent with the figures above.');
  lines.push('- cognitionAndLearning: 4-6 paragraphs separated by blank lines, covering engagement and progress in each subject.');
  lines.push('- successes[x]: 4-6 short bullet points per subject. challenges[x]: 3-8 per subject, phrased constructively.');
  lines.push('- targets: 6-12 short actionable targets drawn from the key actions, across all subjects.');
  lines.push('- communicationAndInteraction: 2-3 sentences, based only on the comments.');
  lines.push('- socialEmotionalMentalHealth and sensoryPhysical: only what tutors actually reported; otherwise state that none was identified.');

  return lines.join('\n');
}

export function claudeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export class GenerationRefused extends Error {}

export async function generateWithClaude(term: StudentTerm): Promise<GeneratedContent> {
  const client = new Anthropic();
  const subjects = term.subjects.map((s) => s.subject);

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(term) }],
    output_config: { format: zodOutputFormat(buildSchema(subjects)) },
  });

  if (response.stop_reason === 'refusal') {
    throw new GenerationRefused(
      response.stop_details?.explanation ?? 'The model declined to draft this report.',
    );
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new Error('Structured output did not validate against the schema');

  return parsed as GeneratedContent;
}

/** Rewrites one section, keeping the facts. Used by the per-section regenerate button. */
export async function regenerateSection(
  studentName: string,
  sectionTitle: string,
  currentText: string,
): Promise<string> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Rewrite the "${sectionTitle}" section of ${studentName}'s termly report. Keep every fact exactly as it is — change only the wording. Return the new text only, with no preamble.\n\nCurrent text:\n${currentText}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new GenerationRefused(
      response.stop_details?.explanation ?? 'The model declined to rewrite this section.',
    );
  }

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/** Human-readable reason for falling back, shown to staff in the toolbar. */
export function describeFailure(error: unknown): string {
  if (error instanceof GenerationRefused) return `Claude declined to draft this report: ${error.message}`;
  if (error instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected';
  if (error instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API';
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API';
  if (error instanceof Anthropic.APIError) return `Anthropic API error ${error.status}`;
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}
