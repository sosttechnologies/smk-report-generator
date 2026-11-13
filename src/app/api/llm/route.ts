import { NextResponse } from 'next/server';
import { acceptsImages, available, complete, model, provider } from '@/lib/llm';

export const maxDuration = 300;

/** The one endpoint the UI talks to for anything a model does. */
export async function POST(request: Request) {
  let body: { prompt?: string; system?: string; json?: boolean; images?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }
  if (!available()) {
    return NextResponse.json(
      { error: 'No model is configured on this server. Reports will use the offline template.' },
      { status: 503 },
    );
  }
  if (body.images?.length && !acceptsImages()) {
    return NextResponse.json({ error: `The ${provider()} model here cannot read images.` }, { status: 415 });
  }
  if ((body.prompt?.length ?? 0) > 400_000) {
    return NextResponse.json({ error: 'That is too much text for one request.' }, { status: 413 });
  }

  try {
    const out = await complete({
      prompt: body.prompt,
      system: body.system,
      json: !!body.json,
      images: body.images,
    });
    return NextResponse.json({ text: out.text, model: out.model });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Model request failed' }, { status: 502 });
  }
}

/** Lets the UI know what it is talking to, without revealing a key. */
export async function GET() {
  return NextResponse.json({ available: available(), provider: provider(), model: model(), images: acceptsImages() });
}
