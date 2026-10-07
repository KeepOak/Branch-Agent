/** Advisory occurrence previews adapted from DeerFlow scheduled_tasks.py.
 * bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193.
 * The existing Branch scheduler owns cron grammar and DST semantics.
 */
import { computeNextRunAtMs } from "./schedule.js";

function localOccurrence(instant: number, formatter: Intl.DateTimeFormat): string {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant))
    .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const offset = parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName?.replace(/^GMT/u, "");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** Read-only preview: never reserves runs, changes jobs, or arms a timer. */
export function previewCronSchedule(input: {
  cron: string;
  timezone: string;
  count?: number;
  startAtMs?: number;
}) {
  const cron = input.cron.trim(), timezone = input.timezone.trim();
  const count = input.count ?? 5, startAtMs = input.startAtMs ?? Date.now();
  if (!cron || !timezone) throw new Error("Cron expression and timezone are required");
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new Error("Preview count must be an integer from 1 to 10");
  }
  if (!Number.isFinite(startAtMs) || !Number.isFinite(new Date(startAtMs).getTime())) {
    throw new Error("Preview start must be a valid timestamp");
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    timeZoneName: "longOffset",
  });
  const occurrences: { runAt: string; localTime: string }[] = [];
  let cursor = startAtMs;
  for (let index = 0; index < count; index++) {
    const next = computeNextRunAtMs({ kind: "cron", expr: cron, tz: timezone }, cursor);
    if (next === undefined || next <= cursor) {
      throw new Error("Cron expression did not produce a future occurrence");
    }
    occurrences.push({ runAt: new Date(next).toISOString(), localTime: localOccurrence(next, formatter) });
    cursor = next;
  }
  return { cron, timezone, startAt: new Date(startAtMs).toISOString(), occurrences };
}
