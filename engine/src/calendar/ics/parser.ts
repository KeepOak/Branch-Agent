// Copied from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:plugins/plugin-calendar/src/ics/parser.ts (atlas INTEGRATIONS-0069)
/**
 * Strict RFC 5545 ingestion for subscription feeds.
 *
 * Structural corruption fails the whole source; malformed VEVENTs become
 * explicit per-event issues so one bad school entry cannot erase a prior good
 * snapshot or make the source look authoritatively empty.
 */

import { createHash } from "node:crypto";
import { IcsError } from "./errors.js";
import type { IcsAttendee, IcsParsedCalendar, IcsParsedEvent, IcsParseIssue } from "./types.js";
import { resolveIcsTimeZoneId } from "./windows-timezones.js";
import {
  addDaysToLocalDate,
  buildUtcDateFromLocalParts,
  getZonedDateParts,
  type LocalDate,
  type ZonedDateParts,
} from "./zoned-time.js";

const MAX_UNFOLDED_LINES = 50_000;
const MAX_UNFOLDED_LINE_LENGTH = 32_768;
const CONTENT_LINE_NAME = /^[A-Z0-9-]+$/;
const DATE_VALUE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME_VALUE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/;
const DURATION_VALUE = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

interface IcsContentLine {
  name: string;
  params: Map<string, string[]>;
  value: string;
  serializedName: string;
}

interface IcsComponent {
  properties: Map<string, IcsContentLine[]>;
}

interface ParsedDateValue {
  instant: string;
  isDate: boolean;
  timezone: string;
  localDate: LocalDate;
}

function invalidFeed(code: string, message: string, context?: Record<string, unknown>): never {
  throw new IcsError(message, { code, context, severity: "fatal" });
}

function splitOutsideQuotes(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (character === separator && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (quoted) {
    invalidFeed(
      "ICS_UNTERMINATED_PARAMETER_QUOTE",
      "Calendar feed contains an unterminated quoted parameter.",
    );
  }
  parts.push(current);
  return parts;
}

function indexOfValueDelimiter(line: string): number {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character === ":" && !quoted) {
      return index;
    }
  }
  return -1;
}

function unquoteParameter(value: string): string {
  const trimmed = value.trim();
  const unquoted =
    trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  return unquoted.replaceAll("\\,", ",").replaceAll('\\"', '"');
}

function parseParameter(name: string, rawParameter: string): [string, string[]] {
  const equals = rawParameter.indexOf("=");
  if (equals <= 0) {
    invalidFeed(
      "ICS_INVALID_PARAMETER",
      `Calendar property ${name} contains an invalid parameter.`,
    );
  }
  const parameterName = rawParameter.slice(0, equals).trim().toUpperCase();
  if (!CONTENT_LINE_NAME.test(parameterName)) {
    invalidFeed(
      "ICS_INVALID_PARAMETER_NAME",
      `Calendar property ${name} contains an invalid parameter name.`,
    );
  }
  const parameterValues = splitOutsideQuotes(rawParameter.slice(equals + 1), ",")
    .map(unquoteParameter)
    .filter((entry) => entry.length > 0);
  if (parameterValues.length === 0) {
    invalidFeed("ICS_EMPTY_PARAMETER", `Calendar property ${name} contains an empty parameter.`);
  }
  return [parameterName, parameterValues];
}

function parseContentLine(line: string): IcsContentLine {
  const delimiter = indexOfValueDelimiter(line);
  if (delimiter <= 0) {
    invalidFeed(
      "ICS_INVALID_CONTENT_LINE",
      "Calendar feed contains a content line without a property delimiter.",
    );
  }
  const left = line.slice(0, delimiter);
  const value = line.slice(delimiter + 1);
  const segments = splitOutsideQuotes(left, ";");
  const name = (segments[0] ?? "").trim().toUpperCase();
  if (!CONTENT_LINE_NAME.test(name)) {
    invalidFeed("ICS_INVALID_PROPERTY_NAME", "Invalid calendar property name.", {
      property: name,
    });
  }
  const params = new Map<string, string[]>();
  for (const rawParameter of segments.slice(1)) {
    const [parameterName, parameterValues] = parseParameter(name, rawParameter);
    params.set(parameterName, parameterValues);
  }
  return { name, params, value, serializedName: left };
}

function assertLineLength(line: string, message: string): void {
  if (line.length > MAX_UNFOLDED_LINE_LENGTH) {
    invalidFeed("ICS_LINE_TOO_LONG", message, { limit: MAX_UNFOLDED_LINE_LENGTH });
  }
}

function unfoldLines(content: string): string[] {
  if (content.includes("\0")) {
    invalidFeed("ICS_NUL_BYTE", "Calendar feed contains a forbidden NUL byte.");
  }
  const normalized = content
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  const unfolded: string[] = [];
  for (const physicalLine of normalized.split("\n")) {
    if (physicalLine.startsWith(" ") || physicalLine.startsWith("\t")) {
      const previousIndex = unfolded.length - 1;
      if (previousIndex < 0) {
        invalidFeed(
          "ICS_ORPHAN_CONTINUATION",
          "Calendar feed begins with a folded continuation line.",
        );
      }
      const joined = `${unfolded[previousIndex]}${physicalLine.slice(1)}`;
      unfolded[previousIndex] = joined;
      assertLineLength(joined, "Calendar feed contains an unfolded line above the safety limit.");
      continue;
    }
    if (physicalLine.length === 0) {
      continue;
    }
    assertLineLength(physicalLine, "Calendar feed contains a line above the safety limit.");
    unfolded.push(physicalLine);
    if (unfolded.length > MAX_UNFOLDED_LINES) {
      invalidFeed("ICS_TOO_MANY_LINES", "Calendar feed exceeds the structural line limit.", {
        limit: MAX_UNFOLDED_LINES,
      });
    }
  }
  return unfolded;
}

interface CollectState {
  stack: string[];
  calendar: IcsComponent;
  events: IcsComponent[];
  currentEvent: IcsComponent | null;
  sawCalendar: boolean;
}

function beginComponent(state: CollectState, line: IcsContentLine): void {
  const component = line.value.trim().toUpperCase();
  if (!CONTENT_LINE_NAME.test(component)) {
    invalidFeed("ICS_INVALID_COMPONENT", "Calendar feed contains an invalid component name.");
  }
  if (component === "VCALENDAR") {
    if (state.stack.length > 0 || state.sawCalendar) {
      invalidFeed(
        "ICS_MULTIPLE_CALENDARS",
        "Calendar feed must contain exactly one top-level VCALENDAR.",
      );
    }
    state.sawCalendar = true;
  } else if (state.stack.length === 0) {
    invalidFeed("ICS_COMPONENT_OUTSIDE_CALENDAR", `${component} appears outside VCALENDAR.`);
  }
  state.stack.push(component);
  if (component === "VEVENT") {
    if (state.stack.length !== 2 || state.stack[0] !== "VCALENDAR") {
      invalidFeed("ICS_NESTED_EVENT", "VEVENT must be a direct child of VCALENDAR.");
    }
    state.currentEvent = { properties: new Map() };
  }
}

function endComponent(state: CollectState, line: IcsContentLine): void {
  const component = line.value.trim().toUpperCase();
  const expected = state.stack.pop();
  if (!expected || expected !== component) {
    invalidFeed(
      "ICS_COMPONENT_MISMATCH",
      "Calendar feed contains mismatched BEGIN and END components.",
      { expected: expected ?? null, actual: component },
    );
  }
  if (component === "VEVENT") {
    if (!state.currentEvent) {
      invalidFeed("ICS_EVENT_STATE", "Calendar feed ended a VEVENT that was not open.");
    }
    state.events.push(state.currentEvent);
    state.currentEvent = null;
  }
}

function addProperty(state: CollectState, line: IcsContentLine): void {
  if (state.stack[0] !== "VCALENDAR") {
    invalidFeed("ICS_PROPERTY_OUTSIDE_CALENDAR", "Calendar property appears outside VCALENDAR.");
  }
  const insideEvent = state.stack.at(-1) === "VEVENT";
  if (state.currentEvent && !insideEvent) {
    // Properties of nested components (VALARM and friends) are not event data.
    return;
  }
  const target = state.currentEvent ?? state.calendar;
  const existing = target.properties.get(line.name) ?? [];
  existing.push(line);
  target.properties.set(line.name, existing);
}

function collectComponents(lines: readonly string[]): {
  calendar: IcsComponent;
  events: IcsComponent[];
} {
  const state: CollectState = {
    stack: [],
    calendar: { properties: new Map() },
    events: [],
    currentEvent: null,
    sawCalendar: false,
  };
  for (const rawLine of lines) {
    const line = parseContentLine(rawLine);
    if (line.name === "BEGIN") {
      beginComponent(state, line);
    } else if (line.name === "END") {
      endComponent(state, line);
    } else {
      addProperty(state, line);
    }
  }
  if (state.stack.length > 0) {
    invalidFeed("ICS_UNCLOSED_COMPONENT", "Calendar feed ends before all components are closed.", {
      openComponents: state.stack,
    });
  }
  if (!state.sawCalendar) {
    invalidFeed("ICS_MISSING_CALENDAR", "Calendar feed does not contain VCALENDAR.");
  }
  return { calendar: state.calendar, events: state.events };
}

function firstProperty(component: IcsComponent, name: string): IcsContentLine | null {
  return component.properties.get(name)?.[0] ?? null;
}

function propertyValue(component: IcsComponent, name: string): string | null {
  return firstProperty(component, name)?.value.trim() || null;
}

function decodeIcsText(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }
    const escaped = value[index + 1];
    if (escaped === undefined) {
      decoded += "\\";
      continue;
    }
    index += 1;
    decoded += escaped === "n" || escaped === "N" ? "\n" : escaped;
  }
  return decoded;
}

function validateDateParts(parts: LocalDate & Partial<ZonedDateParts>): void {
  const candidate = new Date(0);
  candidate.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  candidate.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, 0);
  if (
    candidate.getUTCFullYear() !== parts.year ||
    candidate.getUTCMonth() + 1 !== parts.month ||
    candidate.getUTCDate() !== parts.day ||
    candidate.getUTCHours() !== (parts.hour ?? 0) ||
    candidate.getUTCMinutes() !== (parts.minute ?? 0) ||
    candidate.getUTCSeconds() !== (parts.second ?? 0)
  ) {
    throw new Error("Calendar property contains an impossible date or time.");
  }
}

// Outlook/Exchange feeds carry Windows display names in TZID, so raw zone ids
// go through the CLDR windowsZones table before the Intl-backed date math. An
// unresolvable zone throws here and quarantines only that event via the
// per-event issue handler in parseIcsCalendar.
function resolveEventTimeZone(raw: string, field: string): string {
  const resolved = resolveIcsTimeZoneId(raw);
  if (!resolved) {
    throw new Error(
      `${field} time zone "${raw.trim()}" is not a recognized IANA or Windows time zone.`,
    );
  }
  return resolved;
}

function localInstant(parts: ZonedDateParts, timeZone: string): string {
  return buildUtcDateFromLocalParts(timeZone, parts).toISOString();
}

function midnight(date: LocalDate): ZonedDateParts {
  return { ...date, hour: 0, minute: 0, second: 0 };
}

function parseDateOnly(
  property: IcsContentLine,
  dateMatch: RegExpMatchArray | null,
  calendarTimezone: string | null,
  field: string,
): ParsedDateValue {
  if (!dateMatch) {
    throw new Error(`${field} VALUE=DATE must use YYYYMMDD.`);
  }
  const localDate = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
  };
  validateDateParts(localDate);
  const timezone = resolveEventTimeZone(
    property.params.get("TZID")?.[0] ?? calendarTimezone ?? "UTC",
    field,
  );
  return {
    instant: localInstant(midnight(localDate), timezone),
    isDate: true,
    timezone,
    localDate,
  };
}

function parseDateTimeParts(value: string, field: string): ZonedDateParts & { isUtc: boolean } {
  const match = value.match(DATE_TIME_VALUE);
  if (!match) {
    throw new Error(`${field} must use RFC 5545 DATE or DATE-TIME basic format.`);
  }
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
  };
  validateDateParts(parts);
  return { ...parts, isUtc: match[7] === "Z" };
}

function parseDateProperty(
  property: IcsContentLine,
  calendarTimezone: string | null,
  field: string,
): ParsedDateValue {
  const valueKind = property.params.get("VALUE")?.[0]?.toUpperCase();
  const dateMatch = property.value.match(DATE_VALUE);
  if (valueKind === "DATE" || dateMatch) {
    return parseDateOnly(property, dateMatch, calendarTimezone, field);
  }
  const { isUtc, ...parts } = parseDateTimeParts(property.value, field);
  const rawTimezone = isUtc ? "UTC" : (property.params.get("TZID")?.[0] ?? calendarTimezone);
  if (!rawTimezone) {
    throw new Error(`${field} is a floating DATE-TIME without TZID or X-WR-TIMEZONE.`);
  }
  const timezone = resolveEventTimeZone(rawTimezone, field);
  const localDate = { year: parts.year, month: parts.month, day: parts.day };
  if (isUtc) {
    const utc = new Date(0);
    utc.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    utc.setUTCHours(parts.hour, parts.minute, parts.second, 0);
    return { instant: utc.toISOString(), isDate: false, timezone, localDate };
  }
  const instant = localInstant(parts, timezone);
  const resolved = getZonedDateParts(new Date(instant), timezone);
  if (
    resolved.year !== parts.year ||
    resolved.month !== parts.month ||
    resolved.day !== parts.day ||
    resolved.hour !== parts.hour ||
    resolved.minute !== parts.minute ||
    resolved.second !== parts.second
  ) {
    throw new Error(`${field} resolves to a nonexistent local time in ${timezone}.`);
  }
  return { instant, isDate: false, timezone, localDate };
}

function parseDurationMs(value: string): number {
  const match = value.match(DURATION_VALUE);
  if (!match) {
    throw new Error("DURATION is not a supported RFC 5545 duration.");
  }
  const sign = match[1] === "-" ? -1 : 1;
  const weeks = Number(match[2] ?? "0");
  const days = Number(match[3] ?? "0");
  const hours = Number(match[4] ?? "0");
  const minutes = Number(match[5] ?? "0");
  const seconds = Number(match[6] ?? "0");
  const milliseconds =
    (((weeks * 7 + days) * 24 + hours) * 60 * 60 + minutes * 60 + seconds) * 1000;
  if (milliseconds === 0 || sign < 0) {
    throw new Error("DURATION must be a positive, non-zero duration.");
  }
  return milliseconds;
}

function addOneLocalDay(start: ParsedDateValue): ParsedDateValue {
  const next = addDaysToLocalDate(start.localDate, 1);
  return {
    instant: localInstant(midnight(next), start.timezone),
    isDate: true,
    timezone: start.timezone,
    localDate: next,
  };
}

function emailFromCalendarAddress(value: string): string | null {
  const decoded = decodeIcsText(value).trim();
  const withoutScheme = decoded.replace(/^mailto:/i, "");
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(withoutScheme) ? withoutScheme.toLowerCase() : null;
}

function attendeeFromProperty(property: IcsContentLine, organizer: boolean): IcsAttendee {
  const role = property.params.get("ROLE")?.[0]?.toUpperCase() ?? "";
  return {
    email: emailFromCalendarAddress(property.value),
    displayName: property.params.get("CN")?.[0] ?? null,
    responseStatus: property.params.get("PARTSTAT")?.[0]?.toLowerCase() ?? null,
    organizer,
    optional: role === "OPT-PARTICIPANT",
  };
}

function parseRevisionAt(component: IcsComponent): string | null {
  const property = firstProperty(component, "LAST-MODIFIED") ?? firstProperty(component, "DTSTAMP");
  if (!property) {
    return null;
  }
  return parseDateProperty(property, "UTC", property.name).instant;
}

function recurrenceLines(component: IcsComponent): string[] {
  const lines: string[] = [];
  for (const name of ["RRULE", "RDATE", "EXDATE"] as const) {
    for (const property of component.properties.get(name) ?? []) {
      lines.push(`${property.serializedName}:${property.value}`);
    }
  }
  return lines;
}

function resolveEventEnd(
  component: IcsComponent,
  start: ParsedDateValue,
  calendarTimezone: string | null,
): ParsedDateValue {
  const endProperty = firstProperty(component, "DTEND");
  const duration = propertyValue(component, "DURATION");
  if (endProperty && duration) {
    throw new Error("VEVENT cannot contain both DTEND and DURATION.");
  }
  const end = endProperty
    ? parseDateProperty(endProperty, calendarTimezone, "DTEND")
    : duration
      ? {
          ...start,
          instant: new Date(Date.parse(start.instant) + parseDurationMs(duration)).toISOString(),
        }
      : start.isDate
        ? addOneLocalDay(start)
        : start;
  if (Date.parse(end.instant) < Date.parse(start.instant)) {
    throw new Error("VEVENT DTEND precedes DTSTART.");
  }
  if (start.isDate !== end.isDate) {
    throw new Error("VEVENT DTSTART and DTEND value types must match.");
  }
  return end;
}

function parseSequence(component: IcsComponent): number {
  const rawSequence = propertyValue(component, "SEQUENCE") ?? "0";
  if (!/^\d+$/.test(rawSequence)) {
    throw new Error("VEVENT SEQUENCE must be a non-negative integer.");
  }
  return Number(rawSequence);
}

function parseClassification(component: IcsComponent): IcsParsedEvent["classification"] {
  const value = propertyValue(component, "CLASS")?.toLowerCase();
  return value === "public" || value === "private" || value === "confidential" ? value : null;
}

function parseEvent(component: IcsComponent, calendarTimezone: string | null): IcsParsedEvent {
  const uid = propertyValue(component, "UID");
  if (!uid) {
    throw new Error("VEVENT is missing UID.");
  }
  const startProperty = firstProperty(component, "DTSTART");
  if (!startProperty) {
    throw new Error("VEVENT is missing DTSTART.");
  }
  const start = parseDateProperty(startProperty, calendarTimezone, "DTSTART");
  const end = resolveEventEnd(component, start, calendarTimezone);
  const recurrenceIdProperty = firstProperty(component, "RECURRENCE-ID");
  const organizerProperty = firstProperty(component, "ORGANIZER");
  return {
    uid,
    recurrenceId: recurrenceIdProperty
      ? parseDateProperty(recurrenceIdProperty, calendarTimezone, "RECURRENCE-ID").instant
      : null,
    sequence: parseSequence(component),
    revisionAt: parseRevisionAt(component),
    title: decodeIcsText(propertyValue(component, "SUMMARY") ?? ""),
    description: decodeIcsText(propertyValue(component, "DESCRIPTION") ?? ""),
    location: decodeIcsText(propertyValue(component, "LOCATION") ?? ""),
    status: propertyValue(component, "STATUS")?.toLowerCase() ?? "confirmed",
    startAt: start.instant,
    endAt: end.instant,
    isAllDay: start.isDate,
    timezone: start.timezone,
    url: propertyValue(component, "URL"),
    organizer: organizerProperty ? attendeeFromProperty(organizerProperty, true) : null,
    attendees: (component.properties.get("ATTENDEE") ?? []).map((property) =>
      attendeeFromProperty(property, false),
    ),
    recurrence: recurrenceLines(component),
    transparency:
      propertyValue(component, "TRANSP")?.toLowerCase() === "transparent"
        ? "transparent"
        : "opaque",
    classification: parseClassification(component),
    sourceTextTrusted: false,
  };
}

export function parseIcsCalendar(content: string): IcsParsedCalendar {
  const contentHash = createHash("sha256").update(content).digest("hex");
  const components = collectComponents(unfoldLines(content));
  const calendarTimezone = propertyValue(components.calendar, "X-WR-TIMEZONE") ?? null;
  const events: IcsParsedEvent[] = [];
  const issues: IcsParseIssue[] = [];
  for (const [eventIndex, component] of components.events.entries()) {
    try {
      events.push(parseEvent(component, calendarTimezone));
    } catch (error) {
      // A malformed untrusted VEVENT becomes an explicit issue; valid siblings
      // remain available, and state can never read as complete.
      issues.push({
        code: error instanceof IcsError ? error.code : "ICS_INVALID_EVENT",
        message: error instanceof Error ? error.message : String(error),
        eventIndex,
        uid: propertyValue(component, "UID"),
      });
    }
  }
  return {
    name:
      propertyValue(components.calendar, "X-WR-CALNAME") ??
      propertyValue(components.calendar, "NAME"),
    timezone: calendarTimezone,
    method: propertyValue(components.calendar, "METHOD"),
    productId: propertyValue(components.calendar, "PRODID"),
    contentHash,
    state: issues.length === 0 ? "complete" : events.length > 0 ? "partial" : "error",
    events,
    issues,
  };
}
