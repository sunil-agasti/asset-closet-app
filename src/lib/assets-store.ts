import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { resolveAppRoot } from "./app-root";
import { readCSV } from "./csv";
import { latestInventorySnapshot } from "./csv";
import { getVisibleAssetLocations } from "./app-config";

export const ASSET_WORKBOOK_FILENAME = "assets.xlsx";
const LEGACY_ASSET_CSV_FILENAME = "assets.csv";
const ASSET_SHEET_NAME = "Assets";
const DATA_DIR = resolveAppRoot();

let cachedWorkbook: XLSX.WorkBook | null = null;
let cachedMtime = 0;
const cachedSheetData = new Map<string, { version: number; rows: Record<string, string>[]; latest: Record<string, string>[] }>();

function getWorkbook(): XLSX.WorkBook {
  const workbookPath = getAssetWorkbookPath();
  if (!fs.existsSync(workbookPath)) {
    cachedWorkbook = null;
    return XLSX.utils.book_new();
  }
  const stat = fs.statSync(workbookPath);
  const mtime = stat.mtimeMs;
  if (cachedWorkbook && mtime === cachedMtime) return cachedWorkbook;
  const buf = fs.readFileSync(workbookPath);
  cachedWorkbook = XLSX.read(buf, { cellDates: true, raw: false });
  cachedMtime = mtime;
  return cachedWorkbook;
}

function invalidateCache() {
  cachedWorkbook = null;
  cachedMtime = 0;
  cachedSheetData.clear();
}

export function getAssetLocations(): string[] {
  migrateLegacyAssetCsvIfNeeded();
  try {
    const wb = getWorkbook();
    return getVisibleAssetLocations(wb.SheetNames || []);
  } catch {
    return [];
  }
}

export function readAssetRows(sheetName?: string): Record<string, string>[] {
  migrateLegacyAssetCsvIfNeeded();
  try {
    return getSheetData(sheetName).rows.map((row) => ({ ...row }));
  } catch {
    return [];
  }
}

export function readLatestAssetRows(sheetName?: string): Record<string, string>[] {
  migrateLegacyAssetCsvIfNeeded();
  try {
    return getSheetData(sheetName).latest.map((row) => ({ ...row }));
  } catch {
    return [];
  }
}

export function getAssetWorkbookMtime() {
  const workbookPath = getAssetWorkbookPath();
  if (!fs.existsSync(workbookPath)) return 0;
  return fs.statSync(workbookPath).mtimeMs;
}

export function writeAssetRows(rows: Record<string, string>[]) {
  const workbook = XLSX.utils.book_new();
  const headers = collectHeaders(rows);
  const normalizedRows = rows.map((row) => orderRow(row, headers));
  const sheet = headers.length
    ? XLSX.utils.json_to_sheet(normalizedRows, { header: headers })
    : XLSX.utils.aoa_to_sheet([[]]);

  XLSX.utils.book_append_sheet(workbook, sheet, ASSET_SHEET_NAME);
  const workbookBuffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
    compression: true,
  });
  fs.writeFileSync(getAssetWorkbookPath(), workbookBuffer);
  invalidateCache();
}

export function appendAssetRow(row: Record<string, string>) {
  const rows = readAssetRows();
  rows.push(row);
  writeAssetRows(rows);
}

export function seedAssetWorkbookFromCsv() {
  migrateLegacyAssetCsvIfNeeded();
}

function migrateLegacyAssetCsvIfNeeded() {
  const workbookPath = getAssetWorkbookPath();
  if (fs.existsSync(workbookPath)) return;

  const csvPath = path.join(DATA_DIR, LEGACY_ASSET_CSV_FILENAME);
  if (!fs.existsSync(csvPath)) return;

  const rows = readCSV(LEGACY_ASSET_CSV_FILENAME);
  writeAssetRows(rows);
}

function getAssetWorkbookPath() {
  return path.join(DATA_DIR, ASSET_WORKBOOK_FILENAME);
}

function getSheetData(sheetName?: string) {
  const wb = getWorkbook();
  const version = cachedMtime;
  const targetSheet = resolveSheetName(wb, sheetName);
  if (!targetSheet || !wb.Sheets[targetSheet]) {
    return { rows: [], latest: [] };
  }

  const cacheKey = targetSheet;
  const cached = cachedSheetData.get(cacheKey);
  if (cached && cached.version === version) {
    return cached;
  }

  const trimmedSheet = trimWorksheetRange(wb.Sheets[targetSheet]);
  const rows = XLSX.utils
    .sheet_to_json<Record<string, unknown>>(trimmedSheet, { defval: "", raw: false })
    .map(stringifyRowValues);
  const latest = latestInventorySnapshot(rows);
  const next = { version, rows, latest };
  cachedSheetData.set(cacheKey, next);
  return next;
}

function resolveSheetName(wb: XLSX.WorkBook, sheetName?: string) {
  if (sheetName && wb.SheetNames.includes(sheetName)) return sheetName;
  if (wb.SheetNames.includes(ASSET_SHEET_NAME)) return ASSET_SHEET_NAME;
  return wb.SheetNames[0];
}

function trimWorksheetRange(sheet: XLSX.WorkSheet) {
  const cellKeys = Object.keys(sheet).filter((key) => !key.startsWith("!"));
  if (!cellKeys.length) return sheet;

  let minCol = Number.POSITIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
  let maxCol = 0;
  let maxRow = 0;

  for (const key of cellKeys) {
    const cell = XLSX.utils.decode_cell(key);
    if (cell.c < minCol) minCol = cell.c;
    if (cell.r < minRow) minRow = cell.r;
    if (cell.c > maxCol) maxCol = cell.c;
    if (cell.r > maxRow) maxRow = cell.r;
  }

  const actualRef = XLSX.utils.encode_range({
    s: { c: minCol, r: minRow },
    e: { c: maxCol, r: maxRow },
  });

  if (sheet["!ref"] === actualRef) return sheet;

  return {
    ...sheet,
    "!ref": actualRef,
  };
}

function collectHeaders(rows: Record<string, string>[]) {
  const headers: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      headers.push(key);
    }
  }

  return headers;
}

function orderRow(row: Record<string, string>, headers: string[]) {
  const ordered: Record<string, string> = {};
  for (const header of headers) {
    ordered[header] = row[header] || "";
  }
  return ordered;
}

function stringifyRowValues(row: Record<string, unknown>) {
  const stringified: Record<string, string> = {};

  for (const [key, value] of Object.entries(row)) {
    stringified[key] = stringifyCell(value);
  }

  return stringified;
}

function stringifyCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
  return String(value);
}
