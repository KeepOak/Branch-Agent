import { openSync, readSync, closeSync, fstatSync } from "node:fs";
import { redactDiagnosticText } from "./diagnostics-redact.js";

/** Reads at most the last `maxBytes` of a file, starting at a line boundary. Missing files read as empty. */
export function readTail(file: string, maxBytes: number): string {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return "";
  }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    closeSync(fd);
  }
}

const ISO = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?";
const LINE_START_TIME = new RegExp(`^(${ISO})`);
/** UI event lines carry their time as a JSON field. */
const JSON_TIME = new RegExp(`"ts":"(${ISO})"`);

/**
 * Keeps the lines of one log that fall in the last `minutes`. A line without a timestamp belongs
 * to the timestamped line before it. Every kept line is redacted.
 */
export function recentLines(text: string, cutoffMs: number): string[] {
  const kept: string[] = [];
  let include = false;
  for (const line of text.split("\n")) {
    const match = LINE_START_TIME.exec(line) ?? JSON_TIME.exec(line);
    if (match) {
      const time = Date.parse(match[1] ?? "");
      include = Number.isFinite(time) && time >= cutoffMs;
    }
    if (include && line.length > 0) kept.push(redactDiagnosticText(line));
  }
  return kept;
}

/** The archive's README: what each file is and what was removed. */
export function reportReadme(minutes: number, nowIso: string): string {
  return [
    "Branch problem report",
    `Created: ${nowIso}`,
    `Covers: up to the last ${minutes} minutes. A busy log can cover less, because only its end is read.`,
    "",
    "desktop.log   app lifecycle lines (start, update, engine start and stop)",
    "gateway.log   engine output for the same period",
    "ui-events.log what you did in the window: places, buttons and menu items by name, dialogs, requests by method name, alerts by text id",
    "",
    "Removed before saving: secrets (tokens, keys, passwords, cookies, bearer values), email addresses, and message text.",
    "The window never records message content, file contents or secrets.",
    "",
  ].join("\n");
}
