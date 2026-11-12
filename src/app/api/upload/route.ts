import { NextResponse } from 'next/server';
import { aggregateSubmissions } from '@/lib/aggregate';
import { ingest, methodFor } from '@/lib/ingest';
import { ExtractionUnavailable } from '@/lib/ingest/extract';

export const maxDuration = 300;

/** Guards against a huge upload tying up a model call. */
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB.` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const { submissions, issues, unmappedHeaders, method, notes } = await ingest(file.name, buffer);

    if (!submissions.length) {
      return NextResponse.json(
        {
          error:
            method === 'document'
              ? 'No tutor submissions could be read from that document. If it is a blank form template, upload a completed one or the Forms export.'
              : 'No usable submissions found in that file.',
          issues,
          unmappedHeaders,
          notes,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      terms: aggregateSubmissions(submissions),
      submissions,
      issues,
      unmappedHeaders,
      notes,
      method,
      submissionCount: submissions.length,
      filename: file.name,
    });
  } catch (error) {
    if (error instanceof ExtractionUnavailable) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Could not read that file',
        method: methodFor(file.name),
      },
      { status: 400 },
    );
  }
}
