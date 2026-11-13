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
import { GENERAL_SUBJECT } from './types';

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
  const ranks: Record<string, number> = {};

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
      // Earlier aliases are better matches: "Completion time" beats "Start time"
      // for the submission stamp even though Forms puts Start time first.
      const rank = field.aliases.findIndex((a) => norm === a || norm.startsWith(a));
      if (!(field.key in map.scalars) || rank < (ranks[field.key] ?? Infinity)) {
        map.scalars[field.key] = header;
        ranks[field.key] = rank;
      }
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

  const dmy = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T,].*)?$/);
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
    let subject = canonicalSubject(text(get('subject')));
    let weekBeginning = parseWeekBeginning(get('weekBeginning'));

    if (!studentName && !subject && !weekBeginning) return; // trailing blank row

    // Only the name is required. Everything else is defaulted, and the default is
    // stated, so a half-filled form still produces a report that says what it lacked.
    if (!studentName) {
      issues.push({ row: rowNumber, field: 'studentName', message: 'Missing student name — row skipped' });
      return;
    }
    const gaps: string[] = [];
    const note = (field: string, message: string) => {
      gaps.push(message);
      issues.push({ row: rowNumber, field, message: `${studentName}: ${message}` });
    };
    if (!subject) {
      subject = GENERAL_SUBJECT;
      note('subject', `no subject recorded — filed under ${GENERAL_SUBJECT}`);
    }
    if (!weekBeginning) {
      const stamped = parseWeekBeginning(get('submittedAt'));
      weekBeginning = stamped ?? toMonday(new Date());
      note('weekBeginning', stamped ? 'no week recorded — used the week the form was submitted' : 'no week recorded — used the current week');
    }

    const attendance = parseWeeklyAttendance(get('weeklyAttendance'));
    if (!attendance) {
      const raw = text(get('weeklyAttendance'));
      note('weeklyAttendance', raw ? `unrecognised attendance value ("${raw}") — left unrecorded` : 'attendance not recorded');
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

    if (!Object.keys(engagement).length && !Object.keys(academics).length) note('ratings', 'no ratings given');
    const concerns = text(get('concerns'));
    const keyActions = text(get('keyActions'));
    const generalComments = text(get('generalComments'));
    if (!concerns && !keyActions && !generalComments) note('comments', 'no comments, concerns or actions written');

    submissions.push({
      id: `${studentKey(studentName)}|${subject}|${weekBeginning}`,
      submittedAt: text(get('submittedAt')) || null,
      studentName: studentName.replace(/\s+/g, ' '),
      instructorName: text(get('instructorName')),
      subject,
      weekBeginning,
      weeklyAttendance: attendance,
      engagement,
      academics,
      concerns,
      keyActions,
      generalComments,
      gaps,
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
