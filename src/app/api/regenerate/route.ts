import { NextResponse } from 'next/server';
import { claudeAvailable, describeFailure, regenerateSection } from '@/lib/generate/claude';

export const maxDuration = 120;

export async function POST(request: Request) {
  const { studentName, sectionTitle, text } = (await request.json()) as {
    studentName?: string;
    sectionTitle?: string;
    text?: string;
  };

  if (!studentName || !sectionTitle || !text) {
    return NextResponse.json(
      { error: 'studentName, sectionTitle and text are required' },
      { status: 400 },
    );
  }

  if (!claudeAvailable()) {
    return NextResponse.json({ error: 'No ANTHROPIC_API_KEY set — cannot regenerate' }, { status: 503 });
  }

  try {
    return NextResponse.json({ text: await regenerateSection(studentName, sectionTitle, text) });
  } catch (error) {
    return NextResponse.json({ error: describeFailure(error) }, { status: 502 });
  }
}
