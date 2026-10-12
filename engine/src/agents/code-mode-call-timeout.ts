import { isRecord } from "@branch/normalization-core/record-coerce";
import { ToolInputError } from "./tools/common.js";

/** Longest per-call Code Mode budget a model may request with timeoutSeconds. */
export const MAX_CODE_MODE_CALL_TIMEOUT_SECONDS = 3_600;
/** Unfinished tool output lines kept in a Code Mode timeout error. */
export const CODE_MODE_TIMEOUT_TAIL_LINES = 40;
const MIN_CODE_MODE_CALL_TIMEOUT_MS = 100;
const MAX_TIMEOUT_TAIL_CHARS = 8_000;

/**
 * Reads the optional per-call budget of a Code Mode exec or wait call.
 * Values above the maximum are clamped so a long request still runs.
 */
export function readCodeModeCallTimeoutMs(params: Record<string, unknown>): number | undefined {
  const value = params.timeoutSeconds;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ToolInputError("timeoutSeconds must be a positive number of seconds.");
  }
  return Math.max(
    MIN_CODE_MODE_CALL_TIMEOUT_MS,
    Math.round(Math.min(value, MAX_CODE_MODE_CALL_TIMEOUT_SECONDS) * 1_000),
  );
}

function readUpdateText(update: unknown): string | undefined {
  if (!isRecord(update)) {
    return undefined;
  }
  // Shell exec keeps its live output tail in details; other tools stream text content.
  const details = isRecord(update.details) ? update.details : undefined;
  if (typeof details?.tail === "string" && details.tail.trim()) {
    return details.tail;
  }
  if (!Array.isArray(update.content)) {
    return undefined;
  }
  const text = update.content
    .flatMap((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .join("\n");
  return text.trim() ? text : undefined;
}

function lastLines(text: string, count: number): string[] {
  const lines = text.replace(/\r\n?/gu, "\n").replace(/\n+$/u, "").split("\n");
  return lines.slice(-count);
}

/**
 * Latest progress output of the bridge tool calls a Code Mode cell still owns,
 * so a timeout can report what the unfinished work printed last.
 */
export class CodeModeToolProgress {
  private readonly tails = new Map<string, { label: string; text: string }>();
  private frozen = false;

  observe(id: string, label: string, update: unknown): void {
    if (this.frozen) {
      return;
    }
    const text = readUpdateText(update);
    if (text !== undefined) {
      this.tails.set(id, { label, text });
    }
  }

  complete(id: string): void {
    if (!this.frozen) {
      this.tails.delete(id);
    }
  }

  /** Keeps the current tails while cancellation settles the unfinished calls. */
  freeze(): void {
    this.frozen = true;
  }

  tailText(lineCount = CODE_MODE_TIMEOUT_TAIL_LINES): string | undefined {
    const sections = [...this.tails.values()].map(({ label, text }) => {
      const lines = lastLines(text, lineCount);
      return "[" + label + ": last " + lines.length + " lines]\n" + lines.join("\n");
    });
    if (sections.length === 0) {
      return undefined;
    }
    const joined = sections.join("\n");
    return joined.length > MAX_TIMEOUT_TAIL_CHARS ? joined.slice(-MAX_TIMEOUT_TAIL_CHARS) : joined;
  }
}

/** Interactive timeout message: names the call budget, the remedy, and unfinished output. */
export function formatCodeModeTimeoutError(
  budgetMs: number,
  progress?: CodeModeToolProgress,
): string {
  const seconds = Math.round(budgetMs / 100) / 10;
  const message =
    "code mode timeout exceeded after the " +
    seconds +
    " s budget of this call. For long commands, pass timeoutSeconds (up to " +
    MAX_CODE_MODE_CALL_TIMEOUT_SECONDS +
    ") on exec or wait instead of re-running the work.";
  const tail = progress?.tailText();
  return tail ? message + "\nOutput of unfinished tool calls:\n" + tail : message;
}
