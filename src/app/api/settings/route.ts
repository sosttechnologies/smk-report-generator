/**
 * Shared settings: the projects list and the report template.
 *
 * One row per organisation — these are genuinely shared, and unlike reports they are
 * small and rarely edited, so last write wins is the right trade.
 */

import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { audit } from '@/lib/audit';
import { db } from '@/lib/db';
import { caller } from '@/lib/session';

export async function PUT(req: Request) {
  const who = await caller();
  if (!who) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { projects?: unknown; template?: unknown; roster?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }

  // Only the keys actually sent are touched, so saving the template cannot wipe the
  // projects list.
  const data: Prisma.SettingsUncheckedUpdateInput = {};
  if (body.projects !== undefined) data.projects = body.projects as Prisma.InputJsonValue;
  if (body.template !== undefined) data.template = body.template as Prisma.InputJsonValue;
  if (body.roster !== undefined) data.roster = body.roster as Prisma.InputJsonValue;

  const saved = await db.settings.upsert({
    where: { organisationId: who.organisationId },
    update: data,
    create: {
      organisationId: who.organisationId,
      projects: (body.projects ?? []) as Prisma.InputJsonValue,
      template: (body.template ?? {}) as Prisma.InputJsonValue,
      roster: (body.roster ?? {}) as Prisma.InputJsonValue,
    },
  });

  await audit({
    organisationId: who.organisationId,
    userId: who.userId,
    action: 'settings.update',
    detail: { keys: Object.keys(data).join(',') },
  });

  return NextResponse.json({ updatedAt: saved.updatedAt.getTime() });
}
