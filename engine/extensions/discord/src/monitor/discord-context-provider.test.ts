import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  appendDiscordContext,
  formatDiscordBotPlatformContext,
  formatDiscordContext,
  type DiscordContext,
} from "./discord-context-provider.js";

interface GoldenCase {
  id: string;
  fn: string;
  kind: string;
  source: string;
  input: unknown[];
  output?: unknown;
  throws?: string;
  errName?: string;
}

const GOLDEN_URL = new URL("./discord-context-provider.golden.json", import.meta.url);
const BOT_PLATFORM_OPEN = '<bot_platform_context platform="Discord">';
const BOT_PLATFORM_CLOSE = "</bot_platform_context>";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(decode);
  }
  if (!isRecord(value)) {
    return value;
  }
  if (value.$undef === true) {
    return undefined;
  }
  if (value.$num === "NaN") {
    return Number.NaN;
  }
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, decode(inner)]));
}

function loadGolden(): GoldenCase[] {
  const parsed: unknown = JSON.parse(readFileSync(GOLDEN_URL, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("golden corpus must be an array");
  }
  return parsed as GoldenCase[];
}

function isRedacted(output: unknown): boolean {
  return isRecord(output) && "$redacted" in output;
}

function invoke(fn: string, args: unknown[]): unknown {
  switch (fn) {
    case "formatDiscordContext":
      return formatDiscordContext(args[0] as DiscordContext);
    case "appendDiscordContext":
      return appendDiscordContext(
        args[0] as string | undefined,
        args[1] as DiscordContext,
        args[2] as boolean,
      );
    case "formatDiscordBotPlatformContext":
      return formatDiscordBotPlatformContext();
    default:
      throw new Error(`unknown function in golden corpus: ${fn}`);
  }
}

function captureThrow(run: () => unknown): Error | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return undefined;
}


const SNOWFLAKE = /^[0-9]+$/;

// Restates the documented rule: a non-snowflake id has markup and control
// characters escaped as numeric references. Golden expectations recorded from
// the replaced module are adjusted only where the exact id attribute appears.
function escapeIdForRule(value: string): string {
  let escaped = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const needsEscape = "&<>\"'".includes(char) || code < 0x20 || code === 0x7f;
    escaped += needsEscape ? `&#x${code.toString(16).padStart(2, "0")};` : char;
  }
  return escaped;
}

function idsOf(context: DiscordContext): string[] {
  return [context.guild?.id, context.channel?.id, context.thread?.id].filter(
    (id): id is string => typeof id === "string",
  );
}

function adjustBlockIds(output: string, context: DiscordContext): string {
  let adjusted = output;
  for (const id of idsOf(context)) {
    if (!SNOWFLAKE.test(id)) {
      adjusted = adjusted.split(`id="${id}"`).join(`id="${escapeIdForRule(id)}"`);
    }
  }
  return adjusted;
}

function expectedForCase(testCase: GoldenCase, args: unknown[]): unknown {
  const output = decode(testCase.output);
  if (typeof output !== "string") {
    return output;
  }
  const context = (testCase.fn === "formatDiscordContext" ? args[0] : args[1]) as DiscordContext;
  return adjustBlockIds(output, context ?? {});
}

const goldenCases = loadGolden();

describe("discord context golden corpus", () => {
  for (const testCase of goldenCases.filter((item) => !isRedacted(item.output))) {
    it(`${testCase.id} ${testCase.kind}: ${testCase.source}`, () => {
      const args = decode(testCase.input) as unknown[];
      if (testCase.throws !== undefined) {
        const error = captureThrow(() => invoke(testCase.fn, args));
        expect(error?.name).toBe(testCase.errName);
        expect(error?.message).toBe(testCase.throws);
        return;
      }
      expect(invoke(testCase.fn, args)).toBe(expectedForCase(testCase, args));
    });
  }
});

describe("formatDiscordBotPlatformContext (golden case is redacted)", () => {
  it("has exactly one redacted constant case in the corpus", () => {
    expect(goldenCases.filter((item) => isRedacted(item.output))).toHaveLength(1);
  });

  it("returns a non-empty block with the opening and closing tags", () => {
    const block = formatDiscordBotPlatformContext();
    expect(block.length).toBeGreaterThan(0);
    expect(block.startsWith(BOT_PLATFORM_OPEN)).toBe(true);
    expect(block.endsWith(BOT_PLATFORM_CLOSE)).toBe(true);
  });

  it("has a non-empty body between the tags", () => {
    const body = formatDiscordBotPlatformContext().split("\n").slice(1, -1);
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body.every((line) => line.trim().length > 0)).toBe(true);
  });
});

describe("formatDiscordContext focused rules", () => {
  it("renders guild, channel with type, and thread in that order", () => {
    expect(
      formatDiscordContext({
        guild: { id: "g-1" },
        channel: { id: "c-2", type: 11 },
        thread: { id: "t-3" },
      }),
    ).toBe(
      '<discord_context>\n  <guild id="g-1" />\n  <channel id="c-2" type="11" />\n  <thread id="t-3" />\n</discord_context>',
    );
  });

  it("omits the type attribute when channel type is absent", () => {
    expect(formatDiscordContext({ channel: { id: "c-9" } })).toBe(
      '<discord_context>\n  <channel id="c-9" />\n</discord_context>',
    );
  });

  it("never prints names or topics", () => {
    const block = formatDiscordContext({
      guild: { id: "g", name: "Secret Guild Name" },
      channel: { id: "c", name: "room-name", topic: "private topic text" },
      thread: { id: "t", name: "thread-name" },
    });
    expect(block).not.toContain("Secret Guild Name");
    expect(block).not.toContain("room-name");
    expect(block).not.toContain("private topic text");
    expect(block).not.toContain("thread-name");
  });

  it("returns undefined for thread-only context even with an id", () => {
    expect(formatDiscordContext({ thread: { id: "t-only" } })).toBeUndefined();
  });

  it("renders a thread only when a channel is present", () => {
    expect(formatDiscordContext({ channel: { id: "c-1" }, thread: { id: "t-1" } })).toBe(
      '<discord_context>\n  <channel id="c-1" />\n  <thread id="t-1" />\n</discord_context>',
    );
  });

  it("treats string and array context as having no fields", () => {
    expect(formatDiscordContext("guild" as unknown as DiscordContext)).toBeUndefined();
    expect(formatDiscordContext([{ id: "g" }] as unknown as DiscordContext)).toBeUndefined();
  });

  it("throws TypeError for null and undefined context", () => {
    expect(() => formatDiscordContext(null as unknown as DiscordContext)).toThrow(
      new TypeError("Cannot destructure property 'guild' of 'context' as it is null."),
    );
    expect(() => formatDiscordContext(undefined as unknown as DiscordContext)).toThrow(
      new TypeError("Cannot destructure property 'guild' of 'context' as it is undefined."),
    );
  });

  it("prints a string channel type as its value", () => {
    expect(formatDiscordContext({ channel: { id: "c", type: "0" as unknown as number } })).toBe(
      '<discord_context>\n  <channel id="c" type="0" />\n</discord_context>',
    );
  });

  it("keeps the quirk: missing ids print as words", () => {
    expect(formatDiscordContext({ guild: {} as { id: string } })).toBe(
      '<discord_context>\n  <guild id="undefined" />\n</discord_context>',
    );
  });
});

describe("appendDiscordContext focused rules", () => {
  const block = '<discord_context>\n  <guild id="g-7" />\n</discord_context>';

  it("returns the prompt unchanged when disabled, without reading context", () => {
    expect(appendDiscordContext("keep me", undefined as unknown as DiscordContext, false)).toBe(
      "keep me",
    );
    expect(appendDiscordContext(undefined, { guild: { id: "g-7" } }, false)).toBeUndefined();
  });

  it("treats null enabled as disabled and omitted enabled as enabled", () => {
    expect(
      appendDiscordContext("base", { guild: { id: "g-7" } }, null as unknown as boolean),
    ).toBe("base");
    expect(appendDiscordContext("base", { guild: { id: "g-7" } })).toBe(`base\n\n${block}`);
  });

  it("joins the prompt and block with a blank line without trimming", () => {
    expect(appendDiscordContext("base\n", { guild: { id: "g-7" } })).toBe(`base\n\n\n${block}`);
  });

  it("returns undefined when the prompt is empty and there is no block", () => {
    expect(appendDiscordContext("", {})).toBeUndefined();
  });

  it("throws TypeError when enabled and context is undefined", () => {
    expect(() => appendDiscordContext("base", undefined as unknown as DiscordContext)).toThrow(
      TypeError,
    );
  });
});

describe("id escaping (card #1030)", () => {
  it("escapes an id that tries to close its attribute and inject a tag", () => {
    expect(formatDiscordContext({ guild: { id: '1" /><evil' } })).toBe(
      '<discord_context>\n  <guild id="1&#x22; /&#x3e;&#x3c;evil" />\n</discord_context>',
    );
  });

  it("escapes apostrophes, ampersands and angle brackets in a channel id", () => {
    expect(formatDiscordContext({ channel: { id: "a'&<b>" } })).toBe(
      '<discord_context>\n  <channel id="a&#x27;&#x26;&#x3c;b&#x3e;" />\n</discord_context>',
    );
  });

  it("escapes control characters so a newline cannot split the tag", () => {
    expect(formatDiscordContext({ guild: { id: "1" }, thread: { id: "t\n9" } })).toBe(
      '<discord_context>\n  <guild id="1" />\n  <thread id="t&#x0a;9" />\n</discord_context>',
    );
  });

  it("leaves digit-only snowflakes unchanged", () => {
    expect(formatDiscordContext({ guild: { id: "123456789012345678" } })).toBe(
      '<discord_context>\n  <guild id="123456789012345678" />\n</discord_context>',
    );
  });
});
