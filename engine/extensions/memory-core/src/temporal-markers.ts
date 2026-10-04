// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421
// packages/memory/src/processors/observational-memory/temporal-markers.ts, date-utils.ts.
// Inserts a time-gap reminder before a user turn that arrives long after the
// previous message, so the model reasons about elapsed time. Branch already
// stamps each message with its absolute time; the gap marker is the addition.

export const TEMPORAL_GAP_REMINDER_TYPE = "temporal-gap";
export const MIN_TEMPORAL_GAP_MS = 10 * 60 * 1000;

export function formatTemporalGap(diffMs: number): string | null {
  if (diffMs < MIN_TEMPORAL_GAP_MS) {
    return null;
  }
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;
  const formatUnit = (value: number, unit: string) => `${value} ${unit}${value === 1 ? "" : "s"}`;
  if (diffMs < hour) {
    const minutes = Math.max(1, Math.round(diffMs / minute));
    return `${formatUnit(minutes, "minute")} later`;
  }
  const formatTwoUnits = (
    primaryMs: number,
    primaryUnit: string,
    secondaryMs: number,
    secondaryUnit: string,
  ) => {
    const primary = Math.floor(diffMs / primaryMs);
    const remainder = diffMs - primary * primaryMs;
    const secondary = Math.floor(remainder / secondaryMs);
    const parts = [formatUnit(primary, primaryUnit)];
    if (secondary > 0) {
      parts.push(formatUnit(secondary, secondaryUnit));
    }
    return `${parts.join(" ")} later`;
  };
  if (diffMs < day) {
    return formatTwoUnits(hour, "hour", minute, "minute");
  }
  if (diffMs < week) {
    return formatTwoUnits(day, "day", hour, "hour");
  }
  if (diffMs < month) {
    return formatTwoUnits(week, "week", day, "day");
  }
  if (diffMs < year) {
    return formatTwoUnits(month, "month", week, "week");
  }
  return formatTwoUnits(year, "year", month, "month");
}

export function formatTemporalTimestamp(date: Date, timeZone?: string): string {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  });
}

function messageTimestamp(message: unknown): number | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const record = message as { timestamp?: unknown; role?: unknown };
  if (typeof record.timestamp === "number" && Number.isFinite(record.timestamp)) {
    return record.timestamp;
  }
  if (typeof record.timestamp === "string") {
    const parsed = Date.parse(record.timestamp);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function messageText(message: unknown): string | undefined {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  return content
    .map((part) => ((part as { type?: unknown; text?: unknown })?.type === "text" ? (part as { text?: unknown }).text : ""))
    .filter((text): text is string => typeof text === "string")
    .join("");
}

/** True when the last prepared message is already the incoming user turn (a retried attempt). */
function isCurrentTurn(message: unknown, currentPrompt: string | undefined): boolean {
  if (!currentPrompt || (message as { role?: unknown } | null)?.role !== "user") {
    return false;
  }
  return messageText(message)?.trim() === currentPrompt.trim();
}

/** Latest timestamp among the prepared session messages before the incoming turn. */
export function findPreviousMessageTimestamp(
  messages: readonly unknown[],
  currentPrompt?: string,
): number | undefined {
  const last = messages.length - 1;
  const start = last >= 0 && isCurrentTurn(messages[last], currentPrompt) ? last - 1 : last;
  for (let index = start; index >= 0; index -= 1) {
    const timestamp = messageTimestamp(messages[index]);
    if (timestamp !== undefined) {
      return timestamp;
    }
  }
  return undefined;
}

/**
 * Build the temporal-gap reminder for the incoming turn, or undefined when the
 * gap is under the threshold or there is no earlier message.
 */
export function buildTemporalGapReminder(params: {
  messages: readonly unknown[];
  currentPrompt?: string;
  now: number;
  timeZone?: string;
}): string | undefined {
  const previous = findPreviousMessageTimestamp(params.messages, params.currentPrompt);
  if (previous === undefined) {
    return undefined;
  }
  const gapMs = params.now - previous;
  const gapText = formatTemporalGap(gapMs);
  if (!gapText) {
    return undefined;
  }
  const timestamp = formatTemporalTimestamp(new Date(params.now), params.timeZone);
  return `<system-reminder type="${TEMPORAL_GAP_REMINDER_TYPE}">${gapText} — ${timestamp}</system-reminder>`;
}
