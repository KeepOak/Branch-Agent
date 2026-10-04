/**
 * Calendar reachability adapted from OpenHands/OpenHands
 * a8c05584ec6bb063a0857460b9cbff48e136919f, src/utils/automation-schedule.ts.
 * Croner owns Branch grammar, optional seconds are first, and a restricted
 * weekday preserves the scheduler's day-of-month/day-of-week OR semantics.
 */
import { Cron } from "croner";

const SINGLE_INT = /^(\d+)$/;
function parseSingleInt(field: string, min: number, max: number): number | null {
  const match = field.match(SINGLE_INT);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

// February 29 is reachable in leap years.
const MAX_DAYS_IN_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const NUMERIC_TERM = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/;

type CronFieldParse =
  | { kind: "invalid" }
  /** Well-formed, but not expanded, so it constrains nothing. */
  | { kind: "unmodelled" }
  | { kind: "values"; values: number[] };

function parseCronField(
  field: string,
  [min, max]: readonly [number, number],
): CronFieldParse {
  const values = new Set<number>();

  for (const term of field.split(",")) {
    const match = term.match(NUMERIC_TERM);
    if (!match) {
      // Croner has additional calendar vocabulary. Its parser owns syntax.
      return { kind: "unmodelled" };
    }

    const [, rangePart, stepPart] = match;
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isFinite(step) || step < 1) return { kind: "invalid" };

    if (rangePart === "*") {
      for (let value = min; value <= max; value += step) values.add(value);
      continue;
    }

    const [startPart, endPart] = (rangePart ?? "").split("-");
    const start = parseSingleInt(startPart ?? "", min, max);
    if (start === null) return { kind: "invalid" };
    if (endPart === undefined) {
      if (stepPart === undefined) {
        values.add(start);
        continue;
      }
      // croniter reads `n/m` as `n-max/m`: step from the start value up to the
      // field maximum, not a single hit at the start.
      for (let value = start; value <= max; value += step) values.add(value);
      continue;
    }
    const end = parseSingleInt(endPart, min, max);
    if (end === null) return { kind: "invalid" };
    // croniter wraps a reversed range like `5-1`; that wrap is not modelled.
    if (end < start) return { kind: "unmodelled" };
    for (let value = start; value <= end; value += step) values.add(value);
  }

  return { kind: "values", values: [...values] };
}

export type CronExpressionValidation =
  | { schedule: string }
  | { error: "invalid" | "unreachable" };

/** Validate CLI input against the production parser before a gateway mutation. */
export function validateCronExpression(raw: string): CronExpressionValidation {
  const schedule = raw.trim();
  if (!schedule) return { error: "invalid" };
  try {
    // Paused parsing creates no timer and uses the same defaults as schedule.ts.
    new Cron(schedule, { paused: true });
  } catch {
    return { error: "invalid" };
  }

  const fields = schedule.split(/\s+/);
  const calendar = fields.length === 6 || fields.length === 7 ? fields.slice(1, 6) : fields;
  if (calendar.length !== 5) return { schedule }; // Croner aliases.
  const [, , dayField = "", monthField = "", weekdayField = ""] = calendar;
  // Croner defaults to DOM OR DOW. A weekday can still fire in a month without
  // the requested date; never reject that valid schedule using DOM alone.
  if (weekdayField !== "*" && weekdayField !== "?") return { schedule };
  const days = parseCronField(dayField, [1, 31]);
  const months = parseCronField(monthField, [1, 12]);
  if (
    days.kind === "values" &&
    months.kind === "values" &&
    !months.values.some((month) =>
      days.values.some((day) => day <= (MAX_DAYS_IN_MONTH[month] ?? 0)),
    )
  ) {
    return { error: "unreachable" };
  }
  return { schedule };
}
