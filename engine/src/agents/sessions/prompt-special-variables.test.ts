// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/data-provider/specs/parsers.spec.ts (atlas TOOLS-0008)
// Also packages/data-provider/specs/parsers.timezone.spec.ts. Changed: upstream mocks dayjs to a fixed
// 2024-04-29 12:34:56 -04:00 clock; here fake timers pin the same instant and the zone is passed explicitly.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  replaceSpecialVars as replaceWithZone,
  specialVariables,
} from "./prompt-special-variables.js";
import { expandPromptTemplate, type PromptTemplate } from "./prompt-templates.js";
import { createSyntheticSourceInfo } from "./source-info.js";

const MOCK_NOW = "2024-04-29T16:34:56.000Z";

function replaceSpecialVars(params: Parameters<typeof replaceWithZone>[0]) {
  return replaceWithZone({ timezone: "America/New_York", ...params });
}

describe("replaceSpecialVars", () => {
  // Create a partial user object for testing
  const mockUser = {
    name: "Test User",
    id: "user123",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(MOCK_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("should return the original text if text is empty", () => {
    expect(replaceSpecialVars({ text: "" })).toBe("");
    expect(replaceSpecialVars({ text: null as unknown as string })).toBe(null);
    expect(replaceSpecialVars({ text: undefined as unknown as string })).toBe(undefined);
  });

  test("should replace {{current_date}} with the current date", () => {
    const result = replaceSpecialVars({ text: "Today is {{current_date}}" });
    expect(result).toBe("Today is 2024-04-29 (Monday)");
  });

  test("should replace {{current_datetime}} with the current datetime", () => {
    const result = replaceSpecialVars({ text: "Now is {{current_datetime}}" });
    expect(result).toBe("Now is 2024-04-29 12:34:56 -04:00 (Monday)");
  });

  test("should replace {{iso_datetime}} with the ISO datetime", () => {
    const result = replaceSpecialVars({ text: "ISO time: {{iso_datetime}}" });
    expect(result).toBe("ISO time: 2024-04-29T16:34:56.000Z");
  });

  test("should use supplied anchor time for date variables", () => {
    const result = replaceSpecialVars({
      text: "{{current_date}} | {{current_datetime}} | {{iso_datetime}}",
      now: "2023-12-31T23:59:58.000Z",
      timezone: "UTC",
    });
    expect(result).toBe(
      "2023-12-31 (Sunday) | 2023-12-31 23:59:58 +00:00 (Sunday) | 2023-12-31T23:59:58.000Z",
    );
  });

  test("should replace special variables with surrounding whitespace", () => {
    const result = replaceSpecialVars({
      text: "{{ current_date }} | {{ current_user }}",
      user: mockUser,
    });

    expect(result).toBe("2024-04-29 (Monday) | Test User");
  });

  test("should replace {{current_user}} with the user name if provided", () => {
    const result = replaceSpecialVars({
      text: "Hello {{current_user}}!",
      user: mockUser,
    });
    expect(result).toBe("Hello Test User!");
  });

  test("should not replace {{current_user}} if user is not provided", () => {
    const result = replaceSpecialVars({
      text: "Hello {{current_user}}!",
    });
    expect(result).toBe("Hello {{current_user}}!");
  });

  test("should not replace {{current_user}} if user has no name", () => {
    const result = replaceSpecialVars({
      text: "Hello {{current_user}}!",
      user: { id: "user123" } as { name?: string },
    });
    expect(result).toBe("Hello {{current_user}}!");
  });

  test("should handle multiple replacements in the same text", () => {
    const result = replaceSpecialVars({
      text: "Hello {{current_user}}! Today is {{current_date}} and the time is {{current_datetime}}. ISO: {{iso_datetime}}",
      user: mockUser,
    });
    expect(result).toBe(
      "Hello Test User! Today is 2024-04-29 (Monday) and the time is 2024-04-29 12:34:56 -04:00 (Monday). ISO: 2024-04-29T16:34:56.000Z",
    );
  });

  test("should be case-insensitive when replacing variables", () => {
    const result = replaceSpecialVars({
      text: "Date: {{CURRENT_DATE}}, User: {{Current_User}}",
      user: mockUser,
    });
    expect(result).toBe("Date: 2024-04-29 (Monday), User: Test User");
  });

  test("should confirm all specialVariables from config.ts get parsed", () => {
    // Create a text that includes all special variables
    const specialVarsText = Object.keys(specialVariables)
      .map((key) => `{{${key}}}`)
      .join(" ");

    const result = replaceSpecialVars({
      text: specialVarsText,
      user: mockUser,
    });

    // Verify none of the original variable placeholders remain in the result
    Object.keys(specialVariables).forEach((key) => {
      const placeholder = `{{${key}}}`;
      expect(result).not.toContain(placeholder);
    });

    // Verify the expected replacements
    expect(result).toContain("2024-04-29 (Monday)"); // current_date
    expect(result).toContain("2024-04-29 12:34:56 -04:00 (Monday)"); // current_datetime
    expect(result).toContain("2024-04-29T16:34:56.000Z"); // iso_datetime
    expect(result).toContain("Test User"); // current_user
  });
});

/**
 * Exercises real timezone conversion so the assertions hold regardless of the machine's local
 * timezone: the anchor instant and the requested zone are both fixed.
 */
describe("replaceSpecialVars timezone handling", () => {
  const anchor = "2024-01-15T18:30:00.000Z";

  test("resolves {{current_datetime}} in the supplied timezone", () => {
    const result = replaceWithZone({
      text: "{{current_datetime}}",
      now: anchor,
      timezone: "America/New_York",
    });
    expect(result).toBe("2024-01-15 13:30:00 -05:00 (Monday)");
  });

  test("resolves {{current_date}} across a day boundary into the local zone", () => {
    const result = replaceWithZone({
      text: "{{current_date}}",
      now: "2024-01-15T02:30:00.000Z",
      timezone: "America/New_York",
    });
    expect(result).toBe("2024-01-14 (Sunday)");
  });

  test("shifts the local day forward for zones ahead of UTC", () => {
    const result = replaceWithZone({
      text: "{{current_date}} | {{current_datetime}}",
      now: anchor,
      timezone: "Asia/Tokyo",
    });
    expect(result).toBe("2024-01-16 (Tuesday) | 2024-01-16 03:30:00 +09:00 (Tuesday)");
  });

  test("keeps {{iso_datetime}} in UTC regardless of timezone", () => {
    const result = replaceWithZone({
      text: "{{iso_datetime}}",
      now: anchor,
      timezone: "Asia/Tokyo",
    });
    expect(result).toBe("2024-01-15T18:30:00.000Z");
  });

  test("falls back to the un-zoned anchor when the timezone is invalid", () => {
    const withInvalid = replaceWithZone({
      text: "{{current_datetime}}",
      now: anchor,
      timezone: "Not/AZone",
    });
    const withNone = replaceWithZone({ text: "{{current_datetime}}", now: anchor });
    expect(withInvalid).toBe(withNone);
  });

  test("ignores an empty timezone string", () => {
    const withEmpty = replaceWithZone({
      text: "{{current_datetime}}",
      now: anchor,
      timezone: "",
    });
    const withNone = replaceWithZone({ text: "{{current_datetime}}", now: anchor });
    expect(withEmpty).toBe(withNone);
  });
});

describe("expandPromptTemplate special variables", () => {
  const template: PromptTemplate = {
    name: "standup",
    description: "Daily standup",
    content: "Standup for {{current_date}} ({{ISO_DATETIME}}) about $1",
    sourceInfo: createSyntheticSourceInfo("/prompts/standup.md", { source: "local" }),
    filePath: "/prompts/standup.md",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(MOCK_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("fills special variables when a template expands", () => {
    const today = replaceWithZone({ text: "{{current_date}}" });
    expect(expandPromptTemplate("/standup billing", [template])).toBe(
      `Standup for ${today} (2024-04-29T16:34:56.000Z) about billing`,
    );
  });

  test("leaves special variables typed as an argument untouched", () => {
    expect(expandPromptTemplate('/standup "{{current_date}}"', [template])).toMatch(
      /about \{\{current_date\}\}$/,
    );
  });

  test("leaves text that is not a template unchanged", () => {
    expect(expandPromptTemplate("Today is {{current_date}}", [template])).toBe(
      "Today is {{current_date}}",
    );
  });
});
