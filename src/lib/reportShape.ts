/**
 * Translating between the browser's report object and the database row.
 *
 * artifact2/app.js holds a report as one object. A few of its fields earn real columns —
 * the ones the sidebar sorts and filters by — and everything else (blocks, matrix,
 * header, footer, logo, term, flags, history) lives in the `doc` JSON. Normalising the
 * document into rows would be a large rewrite that buys nothing: nothing queries inside
 * it, and it is always read and written whole.
 */

import type { Prisma, Report } from '@prisma/client';

/** Fields promoted to columns; everything else on the object goes into `doc`. */
const COLUMNS = [
  'id', 'student', 'keyStage', 'status', 'projectId',
  'pinned', 'archived', 'unread', 'reviewed', 'createdAt', 'updatedAt',
] as const;

export interface ClientReport {
  id: string;
  student?: string;
  keyStage?: string;
  status?: string;
  projectId?: string | null;
  pinned?: boolean;
  archived?: boolean;
  unread?: boolean;
  reviewed?: Record<string, boolean>;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export function toRow(r: ClientReport): Omit<Prisma.ReportUncheckedCreateInput, 'organisationId'> {
  const doc: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (!(COLUMNS as readonly string[]).includes(k)) doc[k] = v;
  }
  return {
    id: r.id,
    student: String(r.student ?? '').slice(0, 200),
    keyStage: String(r.keyStage ?? '').slice(0, 60),
    status: String(r.status ?? 'Draft').slice(0, 40),
    projectId: r.projectId ?? null,
    pinned: Boolean(r.pinned),
    archived: Boolean(r.archived),
    unread: Boolean(r.unread),
    reviewed: (r.reviewed ?? {}) as Prisma.InputJsonValue,
    doc: doc as Prisma.InputJsonValue,
  };
}

export function toClient(row: Report): ClientReport {
  const doc = (row.doc ?? {}) as Record<string, unknown>;
  return {
    ...doc,
    id: row.id,
    student: row.student,
    keyStage: row.keyStage,
    status: row.status,
    projectId: row.projectId,
    pinned: row.pinned,
    archived: row.archived,
    unread: row.unread,
    reviewed: (row.reviewed ?? {}) as Record<string, boolean>,
    createdAt: row.createdAt.getTime(),
    // The client compares this to decide what needs saving, and sends it back for the
    // conflict check, so it must be the database's value, not the browser's.
    updatedAt: row.updatedAt.getTime(),
  };
}
