import fs from "fs";
import path from "path";
import { resolveAppRoot } from "./app-root";

const DATA_DIR = resolveAppRoot();

export function readCSV(filename: string): Record<string, string>[] {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) return [];
  const content = fs.readFileSync(filepath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] || "").trim();
    });
    return row;
  });
}

export function writeCSV(filename: string, rows: Record<string, string>[]) {
  if (rows.length === 0) return;
  const filepath = path.join(DATA_DIR, filename);
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(escapeCSV).join(","),
    ...rows.map((row) => headers.map((h) => escapeCSV(row[h] || "")).join(",")),
  ];
  fs.writeFileSync(filepath, lines.join("\n") + "\n", "utf-8");
}

export function appendCSVRow(filename: string, row: Record<string, string>) {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) {
    const headers = Object.keys(row);
    fs.writeFileSync(filepath, headers.map(escapeCSV).join(",") + "\n", "utf-8");
  }
  const content = fs.readFileSync(filepath, "utf-8");
  const headers = parseCSVLine(content.split("\n")[0]);
  const line = headers.map((h) => escapeCSV(row[h] || "")).join(",");
  fs.appendFileSync(filepath, line + "\n", "utf-8");
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && inQuotes && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function latestInventorySnapshot(rows: Record<string, string>[]): Record<string, string>[] {
  const bySerial = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const serial = (row["Serial Number"] || "").trim();
    if (!serial) continue;
    const existing = bySerial.get(serial);
    if (!existing) {
      bySerial.set(serial, row);
    } else {
      const existDate = parseDate(existing["Date"]);
      const newDate = parseDate(row["Date"]);
      if (newDate >= existDate) {
        bySerial.set(serial, row);
      }
    }
  }
  return Array.from(bySerial.values()).sort((a, b) => {
    const da = parseDate(a["Date"]);
    const db = parseDate(b["Date"]);
    return db - da;
  });
}

function parseDate(dateStr: string): number {
  if (!dateStr || !dateStr.trim()) return 0;
  const d = new Date(dateStr.trim());
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
