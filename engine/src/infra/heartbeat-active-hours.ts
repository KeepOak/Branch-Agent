// Evaluates heartbeat active-hours windows.
import { resolveUserTimezone } from "../agents/date-time.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { HeartbeatConfig } from "./heartbeat-config.js";

// Heartbeat active-hours helpers interpret user/local/IANA timezones and treat
// invalid config as permissive so bad schedules do not disable heartbeats.
const ACTIVE_HOURS_TIME_PATTERN = /^(?:([01]\d|2[0-3]):([0-5]\d)|24:00)$/;

/** Resolve the formatter used to evaluate heartbeat active hours. */
function resolveActiveHoursFormatter(
  cfg: BranchConfig,
  raw?: string,
): Intl.DateTimeFormat | null {
  let timeZone = raw?.trim();
  const isExplicit = timeZone && timeZone !== "user" && timeZone !== "local";
  if (!timeZone || timeZone === "user") {
    timeZone = resolveUserTimezone(cfg.agents?.defaults?.userTimezone);
  } else if (timeZone === "local") {
    const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
    timeZone = host?.trim() || "UTC";
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
  } catch {
    return isExplicit ? resolveActiveHoursFormatter(cfg) : null;
  }
}

function parseActiveHoursTime(opts: { allow24: boolean }, raw?: string): number | null {
  if (!raw || !ACTIVE_HOURS_TIME_PATTERN.test(raw)) {
    return null;
  }
  const [hourStr, minuteStr] = raw.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  return hour === 24 && !opts.allow24 ? null : hour * 60 + minute;
}

function resolveTimeInTimeZone(
  nowMs: number,
  formatter: Intl.DateTimeFormat,
): { minutes: number; day: number } | null {
  try {
    const parts = formatter.formatToParts(new Date(nowMs));
    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        map[part.type] = part.value;
      }
    }
    const hour = Number(map.hour);
    const minute = Number(map.minute);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null;
    }
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(map.weekday ?? "");
    return day < 0 ? null : { minutes: hour * 60 + minute, day };
  } catch {
    return null;
  }
}

/** Missing bounds permit all hours; malformed bounds retain the native fallback. */
function resolveActiveHoursBounds(active: NonNullable<HeartbeatConfig>["activeHours"]) {
  if (!active || (active.start === undefined && active.end === undefined)) {
    return { start: 0, end: 1440 };
  }
  const start = parseActiveHoursTime({ allow24: false }, active.start);
  const end = parseActiveHoursTime({ allow24: true }, active.end);
  return start === null || end === null ? null : { start, end };
}

/** Return true when the current time is inside the configured heartbeat window. */
export function isWithinActiveHours(
  cfg: BranchConfig,
  heartbeat?: HeartbeatConfig,
  nowMs?: number,
): boolean {
  const active = heartbeat?.activeHours;
  if (!active) {
    return true;
  }

  const bounds = resolveActiveHoursBounds(active);
  if (!bounds) {
    return true;
  }
  const { start: startMin, end: endMin } = bounds;
  if (startMin === endMin) {
    return false;
  }

  const formatter = resolveActiveHoursFormatter(cfg, active.timezone);
  if (!formatter) {
    return true;
  }

  const current = resolveTimeInTimeZone(nowMs ?? Date.now(), formatter);
  if (current === null) {
    return true;
  }
  if (active.days !== undefined && !active.days.includes(current.day)) {
    return false;
  }
  const currentMin = current.minutes;
  return endMin > startMin
    ? currentMin >= startMin && currentMin < endMin
    : currentMin >= startMin || currentMin < endMin;
}
