/**
 * Extracts weekly submissions from documents that are not spreadsheets —
 * PDF, DOCX, plain text, Markdown.
 *
 * A Forms *export* is tabular and parsed deterministically (see ../parse.ts). A PDF
 * or Word document of the same responses is not: layout varies, grids become prose,
 * one file may hold many submissions. So this path asks Claude to read the document
 * and return structured rows, validated against a schema.
 *
 * Two consequences staff need to know, surfaced in the UI:
 *   1. This path REQUIRES an API key — there is no deterministic fallback.
 *   2. Extraction can misread a document. Every extracted row is shown for checking
 *      before a report is generated from it.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import mammoth from 'mammoth';
import { z } from 'zod';
import { canonicalSubject, studentKey } from '../parse';
import type { ParseResult, WeeklySubmission } from '../types';

const MODEL = 'claude-opus-5';

const RATING = z.enum(['Excellent', 'Good', 'Average', 'Poor', 'Not applicable']);

const RowSchema = z.object({
  studentName: z.string(),
  instructorName: z.string(),
  subject: z.string(),
  /** ISO yyyy-mm-dd. The model is told to convert dd/MM/yyyy. */
  weekBeginning: z.string(),
  weeklyAttendance: z.enum(['full', 'none', 'partial']),
  engagement: z.object({
    Attendance: RATING.nullable(),
    Punctuality: RATING.nullable(),
    'Preparation for Class': RATING.nullable(),
    'Homework completion': RATING.nullable(),
  }),
  academics: z.object({
    'Meets Deadlines': RATING.nullable(),
    'Quality of work': RATING.nullable(),
    'Understands key terms': RATING.nullable(),
    'Applies knowledge and understanding to new concepts': RATING.nullable(),
    'Acts on feedback': RATING.nullable(),
  }),
  concerns: z.string(),
  keyActions: z.string(),
  generalComments: z.string(),
});

const ExtractionSchema = z.object({
  submissions: z.array(RowSchema),
  /** Anything the model could not read confidently, shown to staff verbatim. */
  notes: z.array(z.string()),
});

const SYSTEM = `You extract tutor submissions from documents for SMK Gateway, a UK education charity.

The source is the "SMK STUDENT PROGRESS REPORT" Microsoft Form. Each submission covers ONE student, ONE subject and ONE week, and has these fields:
1. STUDENT NAME
2. INSTRUCTURE NAME (the tutor)
3. SUBJECT
4. REPORTING WEEK (WEEK BEGINNING) — a date
5. WEEKLY ATTENDANCE — "100% WEEKLY ATTENDANCE" = full, "0% WEEKLY ATTENDANCE" = none, "ABSENT ON SOME DAY/S DURING THE WEEK" = partial
6. STUDENT ENGAGEMENT — a grid rating Attendance, Punctuality, Preparation for Class, Homework completion
7. ACADEMICS — a grid rating Meets Deadlines, Quality of work, Understands key terms, Applies knowledge and understanding to new concepts, Acts on feedback
8. CONCERNS
9. KEY ACTIONS
10. GENERAL COMMENTS

Rules:
- Extract one object per submission. A document may contain many.
- Transcribe free text EXACTLY as written. Never summarise, correct or improve it.
- Convert dates to ISO yyyy-mm-dd. A dd/MM/yyyy date is day-first (British).
- Use null for any rating not present. Use "" for any free-text field not present.
- Never invent a submission, a rating or a comment. If a field is genuinely absent, leave it empty and add a line to notes.
- If the document contains a blank, unfilled form template, return no submissions and say so in notes.`;

const INSTRUCTION =
  'Extract every tutor submission in this document. Transcribe the free text exactly; do not summarise.';

type Block = Anthropic.ContentBlockParam;

async function buildContent(filename: string, buffer: Buffer): Promise<Block[]> {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.pdf')) {
    return [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
      },
      { type: 'text', text: INSTRUCTION },
    ];
  }

  if (lower.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer });
    return [{ type: 'text', text: `${INSTRUCTION}\n\n---\n${value}` }];
  }

  if (/\.(png|jpe?g|gif|webp)$/.test(lower)) {
    const ext = lower.split('.').pop()!;
    const mediaType = ext === 'jpg' ? 'image/jpeg' : (`image/${ext}` as const);
    return [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data: buffer.toString('base64'),
        },
      },
      { type: 'text', text: INSTRUCTION },
    ];
  }

  // .txt, .md, .doc and anything else we can read as text.
  return [{ type: 'text', text: `${INSTRUCTION}\n\n---\n${buffer.toString('utf8')}` }];
}

export class ExtractionUnavailable extends Error {}

export async function extractFromDocument(
  filename: string,
  buffer: Buffer,
): Promise<ParseResult & { notes: string[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ExtractionUnavailable(
      'Reading PDF, Word and image files needs an ANTHROPIC_API_KEY. Upload the Microsoft Forms Excel or CSV export instead, which is read without a model.',
    );
  }

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: await buildContent(filename, buffer) }],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(response.stop_details?.explanation ?? 'The model declined to read this document.');
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new Error('Could not read structured submissions from that document.');

  const submissions: WeeklySubmission[] = parsed.submissions.map((row) => {
    const subject = canonicalSubject(row.subject);
    const engagement: WeeklySubmission['engagement'] = {};
    for (const [key, value] of Object.entries(row.engagement)) {
      if (value) engagement[key as keyof WeeklySubmission['engagement']] = value;
    }
    const academics: WeeklySubmission['academics'] = {};
    for (const [key, value] of Object.entries(row.academics)) {
      if (value) academics[key as keyof WeeklySubmission['academics']] = value;
    }
    return {
      id: `${studentKey(row.studentName)}|${subject}|${row.weekBeginning}`,
      submittedAt: null,
      studentName: row.studentName.trim().replace(/\s+/g, ' '),
      instructorName: row.instructorName.trim(),
      subject,
      weekBeginning: row.weekBeginning,
      weeklyAttendance: row.weeklyAttendance,
      engagement,
      academics,
      concerns: row.concerns,
      keyActions: row.keyActions,
      generalComments: row.generalComments,
    };
  });

  return { submissions, issues: [], unmappedHeaders: [], notes: parsed.notes };
}
