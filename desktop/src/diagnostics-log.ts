import { appendFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";

/** The UI event log is bounded to three files of 5 MB: the current file and two rotated copies. */
export const UI_LOG_MAX_BYTES = 5 * 1024 * 1024;
export const UI_LOG_FILES = 3;

/** An append-only file that rotates by size and keeps a fixed number of files. */
export class RotatingLog {
  private size: number;

  constructor(
    private readonly file: string,
    private readonly maxBytes = UI_LOG_MAX_BYTES,
    private readonly files = UI_LOG_FILES,
  ) {
    this.size = existsSync(file) ? statSync(file).size : 0;
  }

  append(line: string): void {
    const bytes = Buffer.byteLength(line) + 1;
    if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
    appendFileSync(this.file, `${line}\n`);
    this.size += bytes;
  }

  /** The current file first, then the rotated files from newest to oldest. */
  paths(): string[] {
    const rotated = Array.from({ length: this.files - 1 }, (_, i) => `${this.file}.${i + 1}`);
    return [this.file, ...rotated].filter((path) => existsSync(path));
  }

  private rotate(): void {
    rmSync(this.indexed(this.files - 1), { force: true });
    for (let i = this.files - 2; i >= 1; i -= 1) {
      if (existsSync(this.indexed(i))) renameSync(this.indexed(i), this.indexed(i + 1));
    }
    renameSync(this.file, this.indexed(1));
    this.size = 0;
  }

  private indexed(index: number): string {
    return `${this.file}.${index}`;
  }
}

/** Event kinds the window may record. Anything else is dropped. */
export const UI_EVENT_KINDS = ["place.open", "action", "dialog.open", "dialog.close", "request", "alert"] as const;
export type UiEventKind = (typeof UI_EVENT_KINDS)[number];

const LABEL_CHARS = /[^\p{L}\p{N} ,.:;'’()&/!?+-]/gu;
const PLACE = /^[a-z-]{1,32}$/;
const ROLE = /^[a-z-]{1,24}$/;
const METHOD = /^[A-Za-z0-9_./-]{1,64}$/;
const CODE = /^[A-Za-z0-9_.-]{1,48}$/;
const TEXT_ID = /^[0-9a-f]{8}$/;
const MAX_MS = 600_000;

/** A visible label, cleaned. Labels with an address (@) are dropped; the rest keeps letters, digits and basic punctuation. */
export function cleanLabel(raw: unknown, max = 80): string | undefined {
  if (typeof raw !== "string" || raw.includes("@")) return raw === undefined ? undefined : "[omitted]";
  const cleaned = raw.replace(LABEL_CHARS, "").replace(/\s+/g, " ").trim().slice(0, max);
  return cleaned || undefined;
}

/**
 * Validates one event sent by the window and returns its JSON line, or null when it is not a
 * known event. Only the fields listed for each kind are kept; nothing else reaches the file.
 */
export function uiEventLine(input: unknown, nowIso: string): string | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const kind = raw.kind;
  if (typeof kind !== "string" || !(UI_EVENT_KINDS as readonly string[]).includes(kind)) return null;
  const event: Record<string, string | number | boolean> = { ts: nowIso, kind };
  const place = typeof raw.place === "string" && PLACE.test(raw.place) ? raw.place : undefined;
  const name = cleanLabel(raw.name);
  const role = typeof raw.role === "string" && ROLE.test(raw.role) ? raw.role : undefined;
  const method = typeof raw.method === "string" && METHOD.test(raw.method) ? raw.method : undefined;
  const code = typeof raw.code === "string" && CODE.test(raw.code) ? raw.code : undefined;
  const textId = typeof raw.textId === "string" && TEXT_ID.test(raw.textId) ? raw.textId : undefined;
  const ms = typeof raw.ms === "number" && Number.isInteger(raw.ms) && raw.ms >= 0 && raw.ms <= MAX_MS ? raw.ms : undefined;
  if (kind === "place.open" && place) event.place = place;
  if ((kind === "action" || kind === "dialog.open" || kind === "dialog.close") && name) event.name = name;
  if (kind === "action" && role) event.role = role;
  if (kind === "request") {
    // A request without a valid method name says nothing useful, so it is dropped.
    if (!method) return null;
    event.method = method;
    event.ok = raw.ok === true;
    if (code) event.code = code;
    if (ms !== undefined) event.ms = ms;
  }
  if (kind === "alert" && textId) event.textId = textId;
  return JSON.stringify(event);
}
