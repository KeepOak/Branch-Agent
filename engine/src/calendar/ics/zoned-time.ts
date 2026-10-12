// Copied from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:plugins/plugin-calendar/src/internal/time.ts (atlas INTEGRATIONS-0069)

/**
 * Timezone-aware date primitives for ICS ingestion: zoned date-part
 * extraction, offset lookup, and local-date arithmetic built on cached
 * `Intl.DateTimeFormat` instances. Local times resolve with "compatible"
 * disambiguation (earlier instant for a repeated time, forward across a gap).
 */

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export type LocalDate = Pick<ZonedDateParts, "year" | "month" | "day">;

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const OFFSET_SAMPLE_HOURS = [-48, -36, -24, -12, 0, 12, 24, 36, 48];

function getZonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zonedFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  zonedFormatterCache.set(timeZone, formatter);
  return formatter;
}

function getOffsetFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = offsetFormatterCache.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  offsetFormatterCache.set(timeZone, formatter);
  return formatter;
}

export function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const parts = getZonedFormatter(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    if (!part) {
      throw new Error(`missing zoned date part: ${type}`);
    }
    return Number(part);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = getOffsetFormatter(timeZone).formatToParts(date);
  const token = parts.find((part) => part.type === "timeZoneName")?.value?.trim() ?? "GMT";
  if (token === "GMT" || token === "UTC") {
    return 0;
  }
  const match = token.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) {
    throw new Error(`unsupported offset token: ${token}`);
  }
  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

function localPartsToEpochMs(parts: ZonedDateParts): number {
  const d = new Date(0);
  d.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  d.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return d.getTime();
}

function sameZonedParts(left: ZonedDateParts, right: ZonedDateParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function wallDeltaMs(candidate: Date, timeZone: string, baseUtcMs: number): number {
  try {
    return localPartsToEpochMs(getZonedDateParts(candidate, timeZone)) - baseUtcMs;
  } catch {
    return Number.NaN;
  }
}

function exactCandidates(candidates: Date[], timeZone: string, parts: ZonedDateParts): Date[] {
  return candidates
    .filter((candidate) => {
      try {
        return sameZonedParts(getZonedDateParts(candidate, timeZone), parts);
      } catch {
        return false;
      }
    })
    .toSorted((left, right) => left.getTime() - right.getTime());
}

export function buildUtcDateFromLocalParts(timeZone: string, parts: ZonedDateParts): Date {
  const baseUtcMs = localPartsToEpochMs(parts);
  if (!Number.isFinite(baseUtcMs)) {
    throw new RangeError(`Local date-time cannot be resolved in timezone ${timeZone}`);
  }
  const offsets = new Set(
    OFFSET_SAMPLE_HOURS.map((hours) =>
      getTimeZoneOffsetMinutes(new Date(baseUtcMs + hours * HOUR_MS), timeZone),
    ),
  );
  const candidates = [...offsets]
    .map((offsetMinutes) => new Date(baseUtcMs - offsetMinutes * MINUTE_MS))
    .filter((candidate) => Number.isFinite(candidate.getTime()));
  const exact = exactCandidates(candidates, timeZone, parts);
  if (exact[0]) {
    // "Compatible" selects the earlier instant when a fall-back repeats time.
    return exact[0];
  }
  const shiftedForward = candidates
    .map((candidate) => ({ candidate, delta: wallDeltaMs(candidate, timeZone, baseUtcMs) }))
    .filter(({ delta }) => Number.isFinite(delta) && delta > 0)
    .toSorted(
      (left, right) =>
        left.delta - right.delta || left.candidate.getTime() - right.candidate.getTime(),
    );
  if (shiftedForward[0]) {
    // A nonexistent time advances by the timezone gap.
    return shiftedForward[0].candidate;
  }
  throw new RangeError(`Local date-time cannot be resolved in timezone ${timeZone}`);
}

export function addDaysToLocalDate(dateOnly: LocalDate, dayDelta: number): LocalDate {
  const utcDate = new Date(0);
  utcDate.setUTCFullYear(dateOnly.year, dateOnly.month - 1, dateOnly.day + dayDelta);
  utcDate.setUTCHours(12, 0, 0, 0);
  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
  };
}
