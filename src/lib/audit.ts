/**
 * Who did what.
 *
 * These reports are about children and are read by their families, so "who exported
 * this?" and "who deleted it?" must be answerable. Deliberately records ids and actions
 * only — never a student name, never report text. An audit trail that quotes the
 * content would just be a second copy of the data to protect.
 */

import { db } from '@/lib/db';

export type AuditAction =
  | 'report.create'
  | 'report.update'
  | 'report.delete'
  | 'report.export'
  | 'settings.update'
  | 'state.import';

export async function audit(
  entry: {
    organisationId: string;
    userId?: string | null;
    reportId?: string | null;
    action: AuditAction;
    detail?: Record<string, string | number | boolean>;
  },
): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        organisationId: entry.organisationId,
        userId: entry.userId ?? null,
        reportId: entry.reportId ?? null,
        action: entry.action,
        detail: entry.detail ?? {},
      },
    });
  } catch (e) {
    // Never fail the user's action because the log failed. Losing an audit row is bad;
    // losing the edit someone just made is worse, and they would have no idea why.
    console.error('[audit] could not record', entry.action, (e as Error).message);
  }
}
