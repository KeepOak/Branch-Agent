import { describe, expect, it } from "vitest";
import { previewCronSchedule } from "./schedule-preview.js";

const startAtMs = Date.parse("2026-10-04T00:00:00Z");
describe("native cron schedule previews", () => {
  it("returns five future occurrences by default without changing the input", () => {
    const input = { cron: " 0 9 * * * ", timezone: "UTC", startAtMs };
    const result = previewCronSchedule(input);
    expect(result.occurrences).toHaveLength(5);
    expect(result.occurrences[0]).toEqual({ runAt: "2026-10-04T09:00:00.000Z", localTime: "2026-10-04T09:00:00+00:00" });
    expect(result.occurrences[4]?.runAt).toBe("2026-10-08T09:00:00.000Z");
    expect(input.cron).toBe(" 0 9 * * * ");
  });

  it("uses native DST spring-forward semantics and exposes the changing offset", () => {
    const result = previewCronSchedule({ cron: "30 2 * * *", timezone: "America/New_York", count: 2,
      startAtMs: Date.parse("2027-03-13T00:00:00Z") });
    expect(result.occurrences).toEqual([
      { runAt: "2027-03-13T07:30:00.000Z", localTime: "2027-03-13T02:30:00-05:00" },
      { runAt: "2027-03-15T06:30:00.000Z", localTime: "2027-03-15T02:30:00-04:00" },
    ]);
  });

  it("does not duplicate fold occurrences or the reference occurrence", () => {
    const result = previewCronSchedule({ cron: "30 1,3 * * *", timezone: "America/New_York", count: 2,
      startAtMs: Date.parse("2026-11-01T05:30:00Z") });
    expect(result.occurrences.map((item) => item.runAt)).toEqual([
      "2026-11-01T08:30:00.000Z", "2026-11-02T06:30:00.000Z",
    ]);
  });

  it("rejects malformed inputs without inventing fallback schedules", () => {
    const input = { cron: "0 9 * * *", timezone: "UTC", startAtMs };
    for (const count of [0, 11, 1.5, Number.NaN]) expect(() => previewCronSchedule({ ...input, count })).toThrow(/count/);
    expect(() => previewCronSchedule({ ...input, timezone: "Mars/Olympus" })).toThrow();
    expect(() => previewCronSchedule({ ...input, cron: "" })).toThrow(/required/);
    expect(() => previewCronSchedule({ ...input, cron: "not a cron" })).toThrow();
    expect(() => previewCronSchedule({ ...input, startAtMs: Number.POSITIVE_INFINITY })).toThrow(/timestamp/);
  });
});
