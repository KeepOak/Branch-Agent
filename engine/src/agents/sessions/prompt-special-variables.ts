// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/data-provider/src/parsers.ts (atlas TOOLS-0008)
// Also packages/data-provider/src/config.ts (specialVariables). Changed: dayjs formatting is done with Intl so the
// engine needs no new dependency; the output formats are unchanged.

/** Variables a prompt template may use; they are filled automatically when the template expands. */
export const specialVariables = {
  current_date: true,
  current_user: true,
  iso_datetime: true,
  current_datetime: true,
};

type ZonedParts = {
  date: string;
  time: string;
  offset: string;
  weekday: string;
};

const FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "long",
  hourCycle: "h23",
};

function createFormatter(timezone?: string): Intl.DateTimeFormat {
  if (timezone) {
    try {
      return new Intl.DateTimeFormat("en-US", { ...FORMAT_OPTIONS, timeZone: timezone });
    } catch {
      // An unknown zone falls back to the un-zoned instant, as upstream does.
    }
  }
  return new Intl.DateTimeFormat("en-US", FORMAT_OPTIONS);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  return `${sign}${hours}:${String(abs % 60).padStart(2, "0")}`;
}

function zonedParts(now: Date, timezone?: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of createFormatter(timezone).formatToParts(now)) {
    parts[part.type] = part.value;
  }
  const wallClock = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const instant = Math.floor(now.getTime() / 1000) * 1000;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    offset: formatOffset(Math.round((wallClock - instant) / 60_000)),
    weekday: parts.weekday ?? "",
  };
}

/**
 * Replaces {{current_date}}, {{current_datetime}}, {{iso_datetime}} and {{current_user}} in prompt text.
 * Local-time variables follow `timezone` (an IANA zone) when it is valid. {{current_user}} stays as is
 * when no user name is known.
 */
export function replaceSpecialVars({
  text,
  user,
  now: inputNow,
  timezone,
}: {
  text: string;
  user?: { name?: string | null } | null;
  now?: string | number | Date;
  timezone?: string;
}): string {
  let result = text;
  if (!result) {
    return result;
  }

  const now = inputNow != null ? new Date(inputNow) : new Date();
  const zoned = zonedParts(now, timezone);

  result = result.replace(/{{\s*current_date\s*}}/gi, `${zoned.date} (${zoned.weekday})`);

  const currentDatetime = `${zoned.date} ${zoned.time} ${zoned.offset}`;
  result = result.replace(/{{\s*current_datetime\s*}}/gi, `${currentDatetime} (${zoned.weekday})`);

  result = result.replace(/{{\s*iso_datetime\s*}}/gi, now.toISOString());

  if (user && user.name) {
    result = result.replace(/{{\s*current_user\s*}}/gi, user.name);
  }

  return result;
}
