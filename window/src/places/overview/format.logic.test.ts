import { afterEach, describe, expect, it, vi } from "vitest";
import { ago, clock, dayWord, money, plural, runLength, whenWord } from "./format";

// Preview 41-placesap helpers from design/spec-v23/index.html (hmPD18, dayWordPD18, agoPD18).
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const hmPD18 = (h: number, m: number) => `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
function dayWordPD18(d: Date, now = new Date()): string {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const diff = Math.round((b.getTime() - a.getTime()) / 864e5);
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : `${DAYS[b.getDay()].slice(0, 3)} ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}
const agoPD18 = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 6e4));
  return m < 1 ? "just now" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function at(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month, day, hour, minute, 0, 0);
}

describe("clock (preview hmPD18)", () => {
  it.each([
    [0, 0, "12:00 AM"],
    [9, 40, "9:40 AM"],
    [11, 59, "11:59 AM"],
    [12, 0, "12:00 PM"],
    [14, 0, "2:00 PM"],
    [23, 5, "11:05 PM"],
  ])("words %i:%s as the preview clock does", (hour, minute, word) => {
    const d = at(2026, 8, 29, hour, minute);
    expect(clock(d)).toBe(word);
    expect(clock(d)).toBe(hmPD18(hour, minute));
  });
});

describe("dayWord (preview dayWordPD18)", () => {
  it("says Today, Yesterday and Tomorrow around midnight", () => {
    const now = at(2026, 8, 29, 0, 1);
    const yesterday = at(2026, 8, 28, 23, 59);
    const today = at(2026, 8, 29, 0, 0);
    const tomorrow = at(2026, 8, 30, 0, 0);
    expect(dayWord(yesterday, now)).toBe("Yesterday");
    expect(dayWord(today, now)).toBe("Today");
    expect(dayWord(tomorrow, now)).toBe("Tomorrow");
    expect(dayWord(yesterday, now)).toBe(dayWordPD18(yesterday, now));
    expect(dayWord(today, now)).toBe(dayWordPD18(today, now));
    expect(dayWord(tomorrow, now)).toBe(dayWordPD18(tomorrow, now));
  });

  it("says Today, Yesterday and Tomorrow across a year boundary", () => {
    const now = at(2026, 0, 1, 0, 30);
    const yesterday = at(2025, 11, 31, 23, 59);
    const today = at(2026, 0, 1, 0, 0);
    const tomorrow = at(2026, 0, 2, 0, 0);
    expect(dayWord(yesterday, now)).toBe("Yesterday");
    expect(dayWord(today, now)).toBe("Today");
    expect(dayWord(tomorrow, now)).toBe("Tomorrow");
    expect(dayWord(yesterday, now)).toBe(dayWordPD18(yesterday, now));
    expect(dayWord(today, now)).toBe(dayWordPD18(today, now));
    expect(dayWord(tomorrow, now)).toBe(dayWordPD18(tomorrow, now));
  });

  it("names older days Mon, Sep 28 as the module documents", () => {
    const now = at(2026, 9, 2, 12, 0);
    const sep28 = at(2026, 8, 28, 17, 2);
    const dec30 = at(2025, 11, 30, 12, 0);
    expect(dayWord(sep28, now)).toBe("Mon, Sep 28");
    expect(dayWord(dec30, now)).toBe("Tue, Dec 30");
    // Preview dayWordPD18 uses "Mon 28 Sep" (no comma, day before month). The module's own
    // comment and whenWord examples keep "Mon, Sep 28", which is what Overview and Inbox show.
    expect(dayWordPD18(sep28, now)).toBe("Mon 28 Sep");
    expect(dayWordPD18(dec30, now)).toBe("Tue 30 Dec");
  });

  it("uses the frozen clock when now is omitted", () => {
    vi.stubEnv("TZ", "UTC");
    vi.useFakeTimers();
    vi.setSystemTime(at(2026, 8, 29, 9, 40));
    expect(dayWord(at(2026, 8, 29, 3, 0))).toBe("Today");
    expect(dayWord(at(2026, 8, 28, 18, 0))).toBe("Yesterday");
    expect(dayWord(at(2026, 8, 30, 0, 0))).toBe("Tomorrow");
  });
});

describe("whenWord", () => {
  it("says Last night for the small hours of today (preview backup line)", () => {
    const now = at(2026, 8, 29, 9, 40);
    expect(whenWord(at(2026, 8, 29, 2, 0).getTime(), now)).toBe("Last night, 2:00 AM");
    expect(whenWord(at(2026, 8, 29, 5, 59).getTime(), now)).toBe("Last night, 5:59 AM");
  });

  it("says Today, 9:40 AM once the morning starts", () => {
    const now = at(2026, 8, 29, 9, 40);
    expect(whenWord(at(2026, 8, 29, 6, 0).getTime(), now)).toBe("Today, 6:00 AM");
    expect(whenWord(at(2026, 8, 29, 9, 40).getTime(), now)).toBe("Today, 9:40 AM");
  });

  it("keeps Yesterday and named days for older times", () => {
    const now = at(2026, 9, 2, 12, 0);
    expect(whenWord(at(2026, 9, 1, 2, 0).getTime(), now)).toBe("Yesterday, 2:00 AM");
    expect(whenWord(at(2026, 8, 28, 17, 2).getTime(), now)).toBe("Mon, Sep 28, 5:02 PM");
  });
});

describe("ago (preview agoPD18)", () => {
  it.each([
    [0, "just now"],
    [29_999, "just now"],
    [30_000, "1 min"],
    [4 * 60_000, "4 min"],
    [59 * 60_000, "59 min"],
    [60 * 60_000, "1 h"],
    [2 * 60 * 60_000, "2 h"],
    [23 * 60 * 60_000, "23 h"],
    [24 * 60 * 60_000, "1 d"],
    [3 * 24 * 60 * 60_000, "3 d"],
    [-5_000, "just now"],
  ])("words %s ms as the preview does", (ms, word) => {
    expect(ago(ms)).toBe(word);
    expect(ago(ms)).toBe(agoPD18(ms));
  });
});

describe("runLength", () => {
  it("words 40s, 1m 12s and 1h 04m as the module documents", () => {
    expect(runLength(40_000)).toBe("40s");
    expect(runLength(72_000)).toBe("1m 12s");
    expect(runLength(3_840_000)).toBe("1h 04m");
  });

  it("stays at seconds below a minute and pads minutes once an hour starts", () => {
    expect(runLength(0)).toBe("0s");
    expect(runLength(-1_000)).toBe("0s");
    expect(runLength(59_499)).toBe("59s");
    expect(runLength(59_500)).toBe("1m 00s");
    expect(runLength(3_599_500)).toBe("1h 00m");
  });
});

describe("money and plural", () => {
  it("words 0, 1 and many amounts as en-US dollars", () => {
    expect(money(0)).toBe("$0.00");
    expect(money(1)).toBe("$1.00");
    expect(money(1_286.4)).toBe("$1,286.40");
  });

  it("words 0, 1 and many with the matching noun", () => {
    expect(plural(0, "file")).toBe("0 files");
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(2, "file")).toBe("2 files");
    expect(plural(3, "entry", "entries")).toBe("3 entries");
  });
});
