/**
 * Pseudonymisation boundary.
 *
 * Nothing identifying should reach a third-party model. Before a generation request
 * leaves this server, every student and tutor name is replaced with a stable token;
 * the model writes about "Student A", and the real names are substituted back into
 * its answer here. Anthropic never receives the child's name.
 *
 * IMPORTANT, and it must be said plainly to SIEVEMK rather than buried:
 *
 * 1. Pseudonymisation is NOT anonymisation. Under UK GDPR pseudonymised data is still
 *    personal data (Recital 26) because it can be re-identified with the mapping that
 *    lives here. It reduces risk and demonstrates data minimisation under Article 5(1)(c).
 *    It does not remove any legal obligation.
 * 2. Free text is scrubbed by name matching, which is imperfect. A tutor who writes
 *    "his mum collects him" or names a sibling, school or street defeats it. The
 *    residual-risk check in `findResidualRisks` flags the common shapes for staff to
 *    review, but the only reliable control over free text is what tutors are told to
 *    write in the form.
 * 3. The report's SOCIAL, EMOTIONAL AND MENTAL HEALTH and SENSORY/PHYSICAL sections
 *    attract health data — Article 9 special category. Tokens do not change that.
 */

import type { StudentTerm, WeeklySubmission } from './types';

export interface Pseudonym {
  /** token -> real value, e.g. "Student A" -> "George Holmes" */
  map: Record<string, string>;
  studentToken: string;
  studentFirstToken: string;
}

/** Longest first, so "George Holmes" is replaced before "George". */
function orderedNames(names: string[]): string[] {
  return [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces each name with its token, respecting word boundaries and case. */
function applyMap(text: string, pairs: [string, string][]): string {
  let out = text;
  for (const [real, token] of pairs) {
    out = out.replace(new RegExp(`\\b${escapeRegex(real)}\\b`, 'gi'), token);
  }
  return out;
}

/**
 * Builds a token map and returns a copy of the term with every name replaced.
 * Tutor names become "Tutor 1", "Tutor 2" — they are staff, but they are still
 * identifiable people and are not needed for drafting.
 */
export function pseudonymise(term: StudentTerm): { term: StudentTerm; pseudonym: Pseudonym } {
  const studentToken = 'Student A';
  const studentFirstToken = 'Student A';
  const map: Record<string, string> = { [studentToken]: term.studentName };

  const full = term.studentName.trim().replace(/\s+/g, ' ');
  const parts = full.split(' ');
  const pairs: [string, string][] = [[full, studentToken]];
  // Replace the forename and surname separately too — tutors rarely write the full name.
  for (const part of orderedNames(parts)) {
    if (part.length > 2) pairs.push([part, studentToken]);
  }

  const tutors = orderedNames(term.submissions.map((s) => s.instructorName));
  tutors.forEach((tutor, i) => {
    const token = `Tutor ${i + 1}`;
    map[token] = tutor;
    pairs.push([tutor, token]);
    // "J. Mensah" is also written as "Mensah" in comments.
    for (const piece of tutor.split(/[.\s]+/).filter((p) => p.length > 2)) {
      pairs.push([piece, token]);
    }
  });

  const scrub = (text: string) => applyMap(text, pairs);

  const submissions: WeeklySubmission[] = term.submissions.map((s, i) => ({
    ...s,
    // The id is built from the student's name upstream, so it leaks too.
    id: `student-a|${s.subject}|${s.weekBeginning}|${i}`,
    studentName: studentToken,
    instructorName: map[`Tutor ${tutors.indexOf(s.instructorName) + 1}`] ? `Tutor ${tutors.indexOf(s.instructorName) + 1}` : 'Tutor',
    concerns: scrub(s.concerns),
    keyActions: scrub(s.keyActions),
    generalComments: scrub(s.generalComments),
  }));

  const subjects = term.subjects.map((subject) => ({
    ...subject,
    instructors: subject.instructors.map((t) => `Tutor ${tutors.indexOf(t) + 1}`),
    concerns: subject.concerns.map(scrub),
    keyActions: subject.keyActions.map(scrub),
    generalComments: subject.generalComments.map(scrub),
  }));

  return {
    term: { ...term, id: 'student-a', studentName: studentToken, submissions, subjects },
    pseudonym: { map, studentToken, studentFirstToken },
  };
}

/** Puts the real names back into whatever the model wrote. */
export function rehydrate<T>(value: T, pseudonym: Pseudonym): T {
  const pairs = Object.entries(pseudonym.map).sort((a, b) => b[0].length - a[0].length);
  const swap = (text: string) => {
    let out = text;
    for (const [token, real] of pairs) {
      out = out.replace(new RegExp(escapeRegex(token), 'g'), real);
    }
    // The model may write the possessive of a token.
    return out;
  };

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return swap(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };

  return walk(value) as T;
}

/**
 * Looks for identifying detail the name swap cannot catch, so staff can redact it
 * before anything is sent. Deliberately noisy: a false positive costs a glance, a
 * false negative sends a child's address to a third party.
 */
export interface ResidualRisk {
  subject: string;
  text: string;
  reason: string;
}

const RISK_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\b(?:\d{1,4}\s+)?[A-Z][a-z]+\s(?:Road|Street|Avenue|Lane|Close|Drive|Way|Court)\b/, reason: 'Looks like an address' },
  { re: /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/, reason: 'Looks like a postcode' },
  { re: /\b(?:07\d{9}|\+44\s?\d{10})\b/, reason: 'Looks like a phone number' },
  { re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/, reason: 'Contains an email address' },
  { re: /\b(?:mum|mother|dad|father|parent|carer|guardian|brother|sister|sibling|grandma|grandad)\b/i, reason: 'Mentions a family member' },
  // Stems match any ending; acronyms must match whole words, or "SEN" hits "Sensitive".
  { re: /\b(?:diagnos|medicat|prescri|autis|dyslex|anxiet|depress|therap)\w*/i, reason: 'Health detail — Article 9 special category data' },
  { re: /\b(?:ADHD|ASD|SEN|SEND|EHCP|CAMHS|IEP)\b/, reason: 'SEND or health acronym — Article 9 special category data' },
  { re: /\b(?:Academy|High School|Primary School|Secondary School|College)\b/, reason: 'Names an institution' },
  { re: /\b(?:social worker|safeguarding|child protection|looked after)\b/i, reason: 'Safeguarding language — review before sending' },
];

export function findResidualRisks(term: StudentTerm): ResidualRisk[] {
  const out: ResidualRisk[] = [];
  for (const subject of term.subjects) {
    const texts = [...subject.generalComments, ...subject.concerns, ...subject.keyActions];
    for (const text of texts) {
      for (const { re, reason } of RISK_PATTERNS) {
        if (re.test(text)) {
          out.push({ subject: subject.subject, text, reason });
          break;
        }
      }
    }
  }
  return out;
}
