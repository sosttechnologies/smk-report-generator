/**
 * Turns a Microsoft Forms export (XLSX or CSV) into WeeklySubmission rows.
 *
 * Nothing here throws on bad data: unreadable cells become ParseIssues so staff can see
 * exactly which rows were skipped and why, rather than losing a whole upload to one typo.
 */

import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import {
  GRID_SPECS,
  METADATA_ALIASES,
  ROW_ALIASES,
  SCALAR_FIELDS,
  normaliseHeader,
  parseRating,
  parseWeeklyAttendance,
} from './formSchema';
import type {
  AcademicRow,
  EngagementRow,
  ParseIssue,
  ParseResult,
  WeeklySubmission,
} from './types';

type Cell = string | number | Date | null;
type Row = Record<string, Cell>;

interface HeaderMap {
  scalars: Record<string, string>;
  engagement: Partial<Record<EngagementRow, string>>;
  academics: Partial<Record<AcademicRow, string>>;
  unmapped: string[];
}

function buildHeaderMap(headers: string[]): HeaderMap {
  const map: HeaderMap = { scalars: {}, engagement: {}, academics: {}, unmapped: [] };

  for (const header of headers) {
    if (!header) continue;
    const norm = normaliseHeader(header);
    if (!norm) continue;

    // Grid columns first: "STUDENT ENGAGEMENT [Punctuality]" would otherwise match
    // the bare "attendance" scalar alias.
    let matched = false;
    for (const spec of GRID_SPECS) {
      const hasPrefix = spec.prefixes.some((p) => norm.startsWith(p));
      for (const row of spec.rows) {
        const aliases = ROW_ALIASES[row] ?? [row.toLowerCase()];
        const hit = aliases.some((a) => (hasPrefix ? norm.includes(a) : norm === a));
        if (hit) {
          const target = spec.grid === 'engagement' ? map.engagement : map.academics;
          if (!(row in target)) {
            (target as Record<string, string>)[row] = header;
            matched = true;
          }
          break;
        }
      }
      if (matched) break;
    }
    if (matched) continue;

    const field = SCALAR_FIELDS.find((f) => f.aliases.some((a) => norm === a || norm.startsWith(a)));
    if (field) {
      if (!(field.key in map.scalars)) map.scalars[field.key] = header;
      continue;
    }

    if (METADATA_ALIASES.includes(norm)) continue;
    map.unmapped.push(header);
  }

  return map;
}

function text(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/** Accepts dd/MM/yyyy (the form's own format), ISO, and real Date cells from XLSX. */
function parseWeekBeginning(value: Cell): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toMonday(value);
  }
  const raw = text(value);
  if (!raw) return null;

  const dmy = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? null : toMonday(date);
  }

  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : toMonday(iso);
}

/** Snap any date to the Monday of its week, so weeks group even if tutors pick mid-week. */
function toMonday(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Title-cases a free-text subject so "maths" and "Maths" don't become two columns. */
export function canonicalSubject(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((w) => (w.length <= 2 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Normalises a student name for grouping; display uses the first spelling seen. */
export function studentKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

function rowsToSubmissions(rows: Row[], headers: string[]): ParseResult {
  const map = buildHeaderMap(headers);
  const issues: ParseIssue[] = [];
  const submissions: WeeklySubmission[] = [];

  const missing = SCALAR_FIELDS.filter((f) => f.required && !map.scalars[f.key]);
  if (missing.length) {
    for (const f of missing) {
      issues.push({ row: 0, field: f.key, message: `No column found for "${f.aliases[0]}"` });
    }
    return { submissions: [], issues, unmappedHeaders: map.unmapped };
  }

  rows.forEach((row, index) => {
    // +2: one for the header row, one because spreadsheet rows are 1-indexed.
    const rowNumber = index + 2;
    const get = (key: string): Cell => {
      const header = map.scalars[key];
      return header ? (row[header] ?? null) : null;
    };

    const studentName = text(get('studentName'));
    const subject = canonicalSubject(text(get('subject')));
    const weekBeginning = parseWeekBeginning(get('weekBeginning'));

    if (!studentName && !subject && !weekBeginning) return; // trailing blank row

    if (!studentName) {
      issues.push({ row: rowNumber, field: 'studentName', message: 'Missing student name — row skipped' });
      return;
    }
    if (!subject) {
      issues.push({ row: rowNumber, field: 'subject', message: 'Missing subject — row skipped' });
      return;
    }
    if (!weekBeginning) {
      issues.push({
        row: rowNumber,
        field: 'weekBeginning',
        message: `Could not read the week beginning ("${text(get('weekBeginning'))}") — row skipped`,
      });
      return;
    }

    const attendance = parseWeeklyAttendance(get('weeklyAttendance'));
    if (!attendance) {
      issues.push({
        row: rowNumber,
        field: 'weeklyAttendance',
        message: `Unrecognised attendance value ("${text(get('weeklyAttendance'))}") — treated as partial`,
      });
    }

    const engagement: WeeklySubmission['engagement'] = {};
    for (const [rowLabel, header] of Object.entries(map.engagement)) {
      const rating = parseRating(row[header!]);
      if (rating) engagement[rowLabel as EngagementRow] = rating;
    }

    const academics: WeeklySubmission['academics'] = {};
    for (const [rowLabel, header] of Object.entries(map.academics)) {
      const rating = parseRating(row[header!]);
      if (rating) academics[rowLabel as AcademicRow] = rating;
    }

    submissions.push({
      id: `${studentKey(studentName)}|${subject}|${weekBeginning}`,
      submittedAt: text(row['Completion time'] ?? row['completion time'] ?? null) || null,
      studentName: studentName.replace(/\s+/g, ' '),
      instructorName: text(get('instructorName')),
      subject,
      weekBeginning,
      weeklyAttendance: attendance ?? 'partial',
      engagement,
      academics,
      concerns: text(get('concerns')),
      keyActions: text(get('keyActions')),
      generalComments: text(get('generalComments')),
    });
  });

  return { submissions, issues, unmappedHeaders: map.unmapped };
}

export async function parseWorkbook(buffer: ArrayBuffer | Buffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return {
      submissions: [],
      issues: [{ row: 0, field: 'file', message: 'The workbook has no sheets' }],
      unmappedHeaders: [],
    };
  }

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? '').trim();
  });

  const rows: Row[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Row = {};
    headers.forEach((header, i) => {
      if (!header) return;
      const value = row.getCell(i + 1).value;
      if (value === null || value === undefined) {
        record[header] = null;
      } else if (value instanceof Date) {
        record[header] = value;
      } else if (typeof value === 'object' && 'text' in value) {
        record[header] = String((value as { text: string }).text);
      } else if (typeof value === 'object' && 'result' in value) {
        record[header] = String((value as { result: unknown }).result ?? '');
      } else {
        record[header] = value as Cell;
      }
    });
    rows.push(record);
  });

  return rowsToSubmissions(rows, headers.filter(Boolean));
}

export function parseCsv(content: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  const headers = parsed.meta.fields ?? [];
  return rowsToSubmissions(parsed.data as Row[], headers);
}

export async function parseUpload(filename: string, buffer: Buffer): Promise<ParseResult> {
  if (/\.csv$/i.test(filename)) return parseCsv(buffer.toString('utf8'));
  return parseWorkbook(buffer);
}
