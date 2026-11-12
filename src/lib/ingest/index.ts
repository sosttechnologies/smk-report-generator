/**
 * Single entry point for every upload.
 *
 * Spreadsheets take the deterministic path; everything else is read by Claude.
 * The result says which path ran so the UI can warn staff to check extracted rows.
 */

import { parseUpload } from '../parse';
import type { ParseResult } from '../types';
import { extractFromDocument } from './extract';

export type IngestMethod = 'spreadsheet' | 'document';

export interface IngestResult extends ParseResult {
  method: IngestMethod;
  notes: string[];
}

const SPREADSHEET = /\.(xlsx|xlsm|csv)$/i;

/** Extensions offered in the file picker. */
export const ACCEPTED_EXTENSIONS =
  '.xlsx,.xlsm,.csv,.pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.webp';

export function methodFor(filename: string): IngestMethod {
  return SPREADSHEET.test(filename) ? 'spreadsheet' : 'document';
}

export async function ingest(filename: string, buffer: Buffer): Promise<IngestResult> {
  if (methodFor(filename) === 'spreadsheet') {
    const result = await parseUpload(filename, buffer);
    return { ...result, method: 'spreadsheet', notes: [] };
  }
  const result = await extractFromDocument(filename, buffer);
  return { ...result, method: 'document' };
}
