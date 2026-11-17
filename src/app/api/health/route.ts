/**
 * What Joshua opens when SMK say "it's broken".
 *
 * Public on purpose — it is the uptime check, and it reveals no data: whether the
 * database answers, whether Chromium is present for PDF export, and which model
 * provider is configured. Never a connection string, never a key.
 */

import { existsSync } from 'node:fs';
import { NextResponse } from 'next/server';
import { authDisabled } from '@/lib/authMode';
import { db } from '@/lib/db';
import { model, provider } from '@/lib/llm';

// Reads the database on every call, so it must never be collected at build time.
export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, unknown> = {};

  try {
    await db.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch (e) {
    checks.db = `failed: ${(e as Error).message.slice(0, 120)}`;
  }

  const chromium = process.env.PUPPETEER_EXECUTABLE_PATH;
  checks.chromium = chromium
    ? existsSync(chromium)
      ? 'ok'
      : `missing at ${chromium}`
    : 'bundled';

  checks.model = { provider: provider(), model: model() };
  checks.signin = (process.env.ALLOWED_EMAILS ?? '').split(',').filter(Boolean).length
    ? 'allowlist set'
    : 'NO ALLOWLIST — nobody can sign in';
  checks.email = process.env.RESEND_API_KEY ? 'ok' : 'no key — links go to the server log';

  // Loud, because it is the one setting that could expose a child's report. It only
  // takes effect for requests from localhost (see lib/authMode), but if anyone sets it
  // on a server they should see it here in red.
  checks.auth = authDisabled()
    ? 'AUTH_DISABLED=true — sign-in skipped for localhost requests only'
    : 'required';

  const ok = checks.db === 'ok' && checks.chromium !== `missing at ${chromium}` && !authDisabled();
  return NextResponse.json({ ok, ...checks }, { status: ok ? 200 : 503 });
}
