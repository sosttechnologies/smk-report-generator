/**
 * Everything the app needs to start: this organisation's reports and settings.
 *
 * One request rather than a dozen, because the UI renders the sidebar, the recents list
 * and the template editor from the same state object it has always used.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toClient } from '@/lib/reportShape';
import { caller } from '@/lib/session';

export async function GET() {
  const who = await caller();
  if (!who) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const [reports, settings] = await Promise.all([
    db.report.findMany({
      where: { organisationId: who.organisationId },
      orderBy: { updatedAt: 'desc' },
    }),
    db.settings.findUnique({ where: { organisationId: who.organisationId } }),
  ]);

  return NextResponse.json({
    user: { email: who.email, role: who.role },
    reports: reports.map(toClient),
    projects: settings?.projects ?? [],
    template: settings?.template ?? null,
  });
}
