// Adapted from Kilo-Org/kilocode 6fd9b7b: packages/opencode/src/kilocode/tool/xlsx.ts.
import { extname } from "node:path";
import { read, utils, type CellObject, type Range, type WorkBook, type WorkSheet } from "xlsx";
import { hiddenOdsSheets } from "./office-ods.js";

const ROW_LIMIT = 50_000;
const MAX_SIZE = 50 * 1024 * 1024;

function cellText(value: CellObject | undefined): string {
  if (!value) {
    return "";
  }
  if (value.f) {
    if (value.w !== undefined && value.w !== null) {
      return value.w;
    }
    return value.v !== undefined && value.v !== null ? String(value.v) : `[Formula: ${value.f}]`;
  }
  if (value.v === undefined || value.v === null) {
    return "";
  }
  if (value.t === "e") {
    return `[Error: ${value.w ?? String(value.v)}]`;
  }
  if (value.t === "d") {
    return value.v instanceof Date ? value.v.toISOString().slice(0, 10) : String(value.v);
  }
  if (value.l?.Target) {
    return `${value.w ?? String(value.v)} (${value.l.Target})`;
  }
  return value.w ?? String(value.v);
}

function sheetRange(sheet: WorkSheet, expand: boolean): Range {
  const initial = utils.decode_range(sheet["!ref"]!);
  if (!expand) {
    return initial;
  }
  return Object.keys(sheet).reduce((result, key) => {
    if (key.startsWith("!")) {
      return result;
    }
    const position = utils.decode_cell(key);
    return {
      s: { r: Math.min(result.s.r, position.r), c: Math.min(result.s.c, position.c) },
      e: { r: Math.max(result.e.r, position.r), c: Math.max(result.e.c, position.c) },
    };
  }, initial);
}

function* sheetLines(sheet: WorkSheet, expand: boolean): Generator<string> {
  if (!sheet["!ref"]) {
    return;
  }
  const range = sheetRange(sheet, expand);
  const end = Math.min(range.e.r, ROW_LIMIT - 1);
  const rows = new Map<number, Map<number, string>>();
  for (const key of Object.keys(sheet)) {
    if (key.startsWith("!")) {
      continue;
    }
    const position = utils.decode_cell(key);
    if (
      position.r < range.s.r ||
      position.r > end ||
      position.c < range.s.c ||
      position.c > range.e.c
    ) {
      continue;
    }
    const value = cellText(sheet[key]);
    if (!value.trim()) {
      continue;
    }
    const row = rows.get(position.r) ?? new Map<number, string>();
    row.set(position.c, value);
    rows.set(position.r, row);
  }
  for (const [, values] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const last = Math.max(...values.keys());
    const row = Array.from(
      { length: last - range.s.c + 1 },
      (_, col) => values.get(col + range.s.c) ?? "",
    );
    yield row.join("\t") + "\n";
  }
  if (range.e.r > end) {
    yield `[... truncated at row ${ROW_LIMIT} ...]\n`;
  }
}

function* workbookLines(
  book: WorkBook,
  invisible: Set<number>,
  expand: boolean,
): Generator<string> {
  const sheets = book.SheetNames.filter((_, index) => {
    const hidden = book.Workbook?.Sheets?.[index]?.Hidden;
    return !invisible.has(index) && hidden !== 1 && hidden !== 2;
  });
  for (const [index, name] of sheets.entries()) {
    if (index > 0) {
      yield "\n";
    }
    yield `--- Sheet: ${name} ---\n`;
    const sheet = book.Sheets[name];
    if (sheet) {
      yield* sheetLines(sheet, expand);
    }
  }
}

export function extractSpreadsheetChunks(filePath: string, input: Buffer): Iterable<string> {
  if (input.byteLength > MAX_SIZE) {
    throw new Error(`Cannot read spreadsheet file: ${filePath} exceeds the 50 MB size limit`);
  }
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`Cannot read spreadsheet file: ${filePath} is not a valid spreadsheet`);
  }
  try {
    const ods = extname(filePath).toLowerCase() === ".ods";
    const book = read(bytes, { type: "array", cellDates: true });
    return workbookLines(book, ods ? hiddenOdsSheets(bytes) : new Set(), ods);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read spreadsheet file: ${filePath}: ${message}`, { cause: error });
  }
}
