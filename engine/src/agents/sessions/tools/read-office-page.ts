import type { ToolResultBudget } from "../../tool-result-limits.js";
import { normalizePositiveLimit } from "./limits.js";
import { createBoundedReadTextPage } from "./read-page.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "./truncate.js";

type OfficePageParams = {
  chunks: Iterable<string>;
  offset?: number;
  limit?: number;
  cursor: number;
  maxBytes: number;
  fileBytes: number;
  note?: string;
  modelBudget?: ToolResultBudget;
  adaptive?: boolean;
  signal?: AbortSignal;
};

type Scan = {
  start: number;
  limit?: number;
  cursor: number;
  line: number;
  lineLength: number;
  firstLineLength: number;
  selectedLines: number;
  selectedBytes: number;
  selectedChars: number;
  selectedHasText: boolean;
  selectedTerminated: boolean;
  cursorPrior?: number;
  cursorNext?: number;
  retained: string;
  retainedChars: number;
  maxRetainedChars: number;
};

function selected(scan: Scan): boolean {
  return (
    scan.line >= scan.start && (scan.limit === undefined || scan.line < scan.start + scan.limit)
  );
}

function retain(scan: Scan, part: string): void {
  scan.selectedBytes += Buffer.byteLength(part, "utf8");
  scan.selectedChars += part.length;
  const remaining = scan.maxRetainedChars - scan.retainedChars;
  if (remaining > 0) {
    const bounded = part.slice(0, remaining);
    scan.retained += bounded;
    scan.retainedChars += bounded.length;
  }
}

function consumePiece(scan: Scan, part: string): void {
  if (selected(scan)) {
    scan.selectedHasText ||= part.length > 0;
    if (scan.line === scan.start) {
      for (const [index, key] of [
        [scan.cursor - 1, "cursorPrior"],
        [scan.cursor, "cursorNext"],
      ] as const) {
        if (index >= scan.lineLength && index < scan.lineLength + part.length) {
          scan[key] = part.charCodeAt(index - scan.lineLength);
        }
      }
      retain(scan, part.slice(Math.max(0, scan.cursor - scan.lineLength)));
    } else {
      retain(scan, part);
    }
  }
  scan.lineLength += part.length;
}

function finishLine(scan: Scan, terminated: boolean): void {
  if (selected(scan)) {
    scan.selectedLines += 1;
    scan.selectedTerminated = terminated;
    if (terminated) {
      retain(scan, "\n");
    }
  }
  if (scan.line === scan.start) {
    scan.firstLineLength = scan.lineLength;
  }
  scan.line += 1;
  scan.lineLength = 0;
}

export function collectOfficeReadPageText(params: OfficePageParams): Scan {
  const scan: Scan = {
    start: (params.offset ?? 1) - 1,
    limit:
      params.limit === undefined
        ? undefined
        : normalizePositiveLimit(params.limit, DEFAULT_MAX_LINES),
    cursor: params.cursor,
    line: 0,
    lineLength: 0,
    firstLineLength: 0,
    selectedLines: 0,
    selectedBytes: 0,
    selectedChars: 0,
    selectedHasText: false,
    selectedTerminated: false,
    retained: "",
    retainedChars: 0,
    maxRetainedChars: Math.max(0, Math.min(DEFAULT_MAX_BYTES, params.maxBytes)) + 2,
  };
  for (const chunk of params.chunks) {
    params.signal?.throwIfAborted();
    const normalized = chunk.replaceAll("\r\n", "\n");
    for (let start = 0; start < normalized.length;) {
      const newline = normalized.indexOf("\n", start);
      const end = newline === -1 ? normalized.length : newline;
      consumePiece(scan, normalized.slice(start, end));
      if (newline !== -1) {
        finishLine(scan, true);
      }
      start = end + 1;
    }
  }
  if (scan.lineLength > 0) {
    finishLine(scan, false);
  }
  return scan;
}

function exceptionalPageText(scan: Scan, params: OfficePageParams): string | undefined {
  if (scan.line === 0) {
    return params.fileBytes === 0
      ? "File is empty (0 bytes)."
      : `File contains no readable text (${params.fileBytes} bytes).`;
  }
  if (scan.start >= scan.line) {
    return `Offset ${params.offset} is beyond end of file (${scan.line} lines total). Retry with offset <= ${scan.line}.`;
  }
  if (params.cursor > 0 && params.cursor >= scan.firstLineLength) {
    const nextLine = scan.start + 1 < scan.line ? ` Use offset=${scan.start + 2} to continue.` : "";
    return `Cursor ${params.cursor} is at or beyond the end of line ${scan.start + 1} (${scan.firstLineLength} characters).${nextLine}`;
  }
  if (
    scan.cursorPrior !== undefined &&
    scan.cursorNext !== undefined &&
    scan.cursorPrior >= 0xd800 &&
    scan.cursorPrior <= 0xdbff &&
    scan.cursorNext >= 0xdc00 &&
    scan.cursorNext <= 0xdfff
  ) {
    throw new Error(
      `Cursor ${params.cursor} splits a UTF-16 surrogate pair; retry with cursor=${params.cursor - 1} or cursor=${params.cursor + 1}.`,
    );
  }
  return undefined;
}

/** Count all extracted lines while retaining only enough selected text for the existing page owner. */
export function createOfficeReadTextPage(params: OfficePageParams) {
  const scan = collectOfficeReadPageText(params);
  const exceptional = exceptionalPageText(scan, params);
  if (exceptional !== undefined) {
    return { text: exceptional, details: { kind: "text" as const, content: exceptional } };
  }
  const endLine = scan.start + scan.selectedLines;
  if (endLine < scan.line && scan.selectedTerminated) {
    if (scan.retainedChars === scan.selectedChars) {
      scan.retained = scan.retained.slice(0, -1);
    }
    scan.selectedBytes -= 1;
  }
  const noteBytes = params.note ? Buffer.byteLength(`${params.note}\n`, "utf8") : 0;
  const page = createBoundedReadTextPage({
    content: scan.retained,
    startLine: scan.start + 1,
    endLine,
    totalLines: scan.line,
    cursor: params.cursor,
    firstLineLength: Math.max(0, scan.firstLineLength - params.cursor),
    limit: scan.limit === undefined ? undefined : scan.selectedLines,
    maxBytes: params.maxBytes,
    modelBudget: params.modelBudget,
    prefix: params.note ? `${params.note}\n` : undefined,
    pageMaxBytes: Math.min(DEFAULT_MAX_BYTES, params.maxBytes) - noteBytes,
    adaptive: params.adaptive,
  });
  if (page.details.kind === "truncated") {
    page.details.truncation.totalBytes = scan.selectedBytes;
  }
  if (!scan.selectedHasText) {
    const subject = scan.start === 0 && endLine === scan.line ? "File" : "Selected range";
    const notice =
      page.details.kind === "truncated" ? page.text.slice(page.details.content.length) : "";
    page.text = `${subject} contains ${scan.selectedLines} blank line${scan.selectedLines === 1 ? "" : "s"}.${notice}`;
  }
  return page;
}
