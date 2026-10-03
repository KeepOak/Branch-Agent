import { describe, expect, it } from "vitest";
import { snoozeChoices, wakeWords } from "./conversation-actions";

describe("snoozeChoices", () => {
  it("offers This evening only when 18:00 is more than an hour away", () => {
    const morning = new Date(2026, 9, 1, 9, 0).getTime(); // a Thursday
    expect(snoozeChoices(morning).map((c) => c.label)).toEqual(["In 1 hour", "In 3 hours", "This evening", "Tomorrow", "Next week"]);
    const late = new Date(2026, 9, 1, 17, 30).getTime();
    expect(snoozeChoices(late).map((c) => c.label)).not.toContain("This evening");
  });
  it("leaves out Next week on a Sunday and puts it on Monday 09:00", () => {
    const sunday = new Date(2026, 9, 4, 10, 0).getTime();
    expect(snoozeChoices(sunday).map((c) => c.label)).not.toContain("Next week");
    const thursday = new Date(2026, 9, 1, 10, 0).getTime();
    const next = snoozeChoices(thursday).find((c) => c.label === "Next week");
    const d = new Date(next?.until ?? 0);
    expect([d.getDay(), d.getHours(), d.getDate()]).toEqual([1, 9, 5]);
  });
  it("Tomorrow is 09:00 the next day", () => {
    const t = snoozeChoices(new Date(2026, 9, 1, 22, 0).getTime()).find((c) => c.label === "Tomorrow");
    const d = new Date(t?.until ?? 0);
    expect([d.getDate(), d.getHours()]).toEqual([2, 9]);
  });
});

describe("wakeWords", () => {
  const now = new Date(2026, 9, 1, 9, 0).getTime();
  it("today, tomorrow, then a weekday", () => {
    expect(wakeWords(new Date(2026, 9, 1, 18, 0).getTime(), now)).toBe("18:00");
    expect(wakeWords(new Date(2026, 9, 2, 9, 0).getTime(), now)).toBe("tomorrow 09:00");
    expect(wakeWords(new Date(2026, 9, 5, 9, 0).getTime(), now)).toMatch(/09:00$/);
  });
});
