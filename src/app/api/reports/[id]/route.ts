/**
 * One report: save it, or delete it.
 *
 * A row per report is the whole reason this is not a single JSON blob — two members of
 * staff editing different students must not overwrite each other. For the same report,
 * the client sends the `updatedAt` it loaded; if the stored row has moved on, this
 * answers 409 with the current version so the UI can say so rather than silently
 * discarding someone's writing.
 */

import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { db } from '@/lib/db';
import { toClient, toRow, type ClientReport } from '@/lib/reportShape';
import { caller } from '@/lib/session';

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const who = await caller();
  if (!who) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { id } = await ctx.params;

  let body: { report?: ClientReport; baseUpdatedAt?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }
  const report = body.report;
  if (!report || report.id !== id) {
    return NextResponse.json({ error: 'Report id does not match the URL' }, { status: 400 });
  }

  // Scoped by organisation, so an id from another organisation simply is not found.
  const existing = await db.report.findFirst({
    where: { id, organisationId: who.organisationId },
    select: { updatedAt: true },
  });

  if (existing && body.baseUpdatedAt != null) {
    const stored = existing.updatedAt.getTime();
    // A second of tolerance: Postgres timestamps and JS millis do not always round-trip
    // exactly, and a false conflict is worse than a missed one here.
    if (Math.abs(stored - body.baseUpdatedAt) > 1000) {
      const current = await db.report.findUniqueOrThrow({ where: { id } });
      return NextResponse.json(
        { error: 'conflict', report: toClient(current) },
        { status: 409 },
      );
    }
  }

  const data = toRow(report);
  const saved = existing
    ? await db.report.update({ where: { id }, data })
    : await db.report.create({
        data: { ...data, organisationId: who.organisationId, createdById: who.userId },
      });

  await audit({
    organisationId: who.organisationId,
    userId: who.userId,
    reportId: saved.id,
    action: existing ? 'report.update' : 'report.create',
  });

  return NextResponse.json({ report: toClient(saved) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const who = await caller();
  if (!who) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { id } = await ctx.params;

  const { count } = await db.report.deleteMany({
    where: { id, organisationId: who.organisationId },
  });
  if (count) {
    await audit({
      organisationId: who.organisationId,
      userId: who.userId,
      action: 'report.delete',
      detail: { reportId: id },
    });
  }
  return NextResponse.json({ deleted: count });
}
