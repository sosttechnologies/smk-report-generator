import { NextResponse } from 'next/server';
import { claudeAvailable, describeFailure, generateWithClaude } from '@/lib/generate/claude';
import { generateFromTemplate } from '@/lib/generate/template';
import { findResidualRisks, pseudonymise, rehydrate } from '@/lib/pseudonymise';
import { buildReport } from '@/lib/report';
import type { ReportSetup, StudentTerm } from '@/lib/types';

export const maxDuration = 300;

interface Body {
  term: StudentTerm;
  setup: ReportSetup;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { term, setup } = body;
  if (!term?.subjects?.length) {
    return NextResponse.json({ error: 'No submissions for this student' }, { status: 400 });
  }

  // Always compute the template first: it is both the offline path and the safety net
  // if the model is unavailable, declines, or returns something that does not validate.
  const fallback = generateFromTemplate(term);

  if (!claudeAvailable()) {
    return NextResponse.json({
      report: buildReport(term, setup, fallback, true),
      note: 'No ANTHROPIC_API_KEY set — drafted from the deterministic template.',
    });
  }

  try {
    // Names never leave this process. The model writes about "Student A"; the real
    // names are substituted back here. See src/lib/pseudonymise.ts.
    const { term: masked, pseudonym } = pseudonymise(term);
    const content = rehydrate(await generateWithClaude(masked), pseudonym);
    return NextResponse.json({
      report: buildReport(term, setup, content, false),
      residualRisks: findResidualRisks(term),
    });
  } catch (error) {
    return NextResponse.json({
      report: buildReport(term, setup, fallback, true),
      note: `${describeFailure(error)} — drafted from the deterministic template instead.`,
    });
  }
}
