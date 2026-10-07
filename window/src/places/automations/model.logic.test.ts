import { afterEach, describe, expect, it, vi } from "vitest";
import {
  autoDisabledWords,
  cronLine,
  customWords,
  emptyForm,
  failing,
  formToSchedule,
  formWords,
  guessFromWords,
  health,
  scheduleToForm,
  scheduleWords,
  type ScheduleForm,
} from "./model";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
});

function form(partial: Partial<ScheduleForm>, now = NOW): ScheduleForm {
  return { ...emptyForm(now), ...partial };
}

function roundTrip(partial: Partial<ScheduleForm>, now = NOW) {
  const start = form(partial, now);
  return scheduleToForm(formToSchedule(start, now), now);
}

describe("formToSchedule then scheduleToForm", () => {
  it("round-trips daily, weekdays, weekends, weekly and monthly Repeats choices", () => {
    expect(roundTrip({ repeat: "daily", time: "09:00" })).toMatchObject({ repeat: "daily", time: "09:00" });
    expect(cronLine(form({ repeat: "daily", time: "09:00" }))).toBe("0 9 * * *");

    expect(roundTrip({ repeat: "weekdays", time: "08:00" })).toMatchObject({ repeat: "weekdays", time: "08:00" });
    expect(cronLine(form({ repeat: "weekdays", time: "08:00" }))).toBe("0 8 * * 1-5");

    expect(roundTrip({ repeat: "weekends", time: "10:30" })).toMatchObject({ repeat: "weekends", time: "10:30" });
    expect(cronLine(form({ repeat: "weekends", time: "10:30" }))).toBe("30 10 * * 0,6");

    expect(roundTrip({ repeat: "weekly", time: "17:00", weekday: 5 })).toMatchObject({
      repeat: "weekly", time: "17:00", weekday: 5,
    });
    expect(cronLine(form({ repeat: "weekly", time: "17:00", weekday: 5 }))).toBe("0 17 * * 5");

    expect(roundTrip({ repeat: "monthly", time: "06:00", monthDay: 1 })).toMatchObject({
      repeat: "monthly", time: "06:00", monthDay: 1,
    });
    expect(cronLine(form({ repeat: "monthly", time: "06:00", monthDay: 1 }))).toBe("0 6 1 * *");
  });

  it("round-trips every-N and once, and keeps exact / spread on a cron line", () => {
    vi.setSystemTime(NOW);
    expect(roundTrip({ repeat: "every", everyN: "30", everyUnit: "minutes" })).toMatchObject({
      repeat: "every", everyN: "30", everyUnit: "minutes",
    });
    expect(formToSchedule(form({ repeat: "every", everyN: "2", everyUnit: "hours" }), NOW)).toEqual({
      kind: "every", everyMs: 7_200_000,
    });

    const once = form({ repeat: "once", at: "2026-12-25T15:30" });
    const saved = formToSchedule(once, NOW);
    expect(saved).toEqual({ kind: "at", at: new Date("2026-12-25T15:30").toISOString() });
    expect(roundTrip({ repeat: "once", at: "2026-12-25T15:30" })).toMatchObject({ repeat: "once" });
    expect(new Date(roundTrip({ repeat: "once", at: "2026-12-25T15:30" }).at).getTime()).toBe(new Date("2026-12-25T15:30").getTime());

    expect(roundTrip({ repeat: "daily", time: "09:00", exact: true })).toMatchObject({
      repeat: "daily", time: "09:00", exact: true, spreadN: "",
    });
    expect(roundTrip({ repeat: "daily", time: "09:00", spreadN: "5", spreadUnit: "minutes" })).toMatchObject({
      repeat: "daily", time: "09:00", exact: false, spreadN: "5", spreadUnit: "minutes",
    });
  });

  it("reads 6,0 as weekends the same as 0,6", () => {
    expect(scheduleToForm({ kind: "cron", expr: "0 8 * * 6,0" }, NOW)).toMatchObject({
      repeat: "weekends", time: "08:00",
    });
  });
});

describe("custom cron lines", () => {
  it("a cron line the Repeats choices can't show stays custom and customWords gives plain words", () => {
    expect(scheduleToForm({ kind: "cron", expr: "*/5 * * * *" }, NOW).repeat).toBe("custom");
    expect(customWords("*/5 * * * *")).toBe("Every 5 minutes");
    expect(scheduleWords({ kind: "cron", expr: "*/5 * * * *" })).toBe("Every 5 minutes");

    expect(scheduleToForm({ kind: "cron", expr: "* * * * *" }, NOW).repeat).toBe("custom");
    expect(customWords("* * * * *")).toBe("Every minute");

    expect(scheduleToForm({ kind: "cron", expr: "0 */2 * * *" }, NOW).repeat).toBe("custom");
    expect(customWords("0 */2 * * *")).toBe("Every 2 hours");
    expect(customWords("0 * * * *")).toBe("Every hour");

    expect(scheduleToForm({ kind: "cron", expr: "0 8 * * 1,3,5" }, NOW).repeat).toBe("custom");
    expect(customWords("0 8 * * 1,3,5")).toBe("On its own schedule");
    expect(scheduleWords({ kind: "cron", expr: "0 8 * * 1,3,5" })).toBe("On its own schedule");
  });
});

describe("schedule words", () => {
  it("matches the preview's sentences for Repeats choices and every-N", () => {
    // schWordsPD18 / whenWords in design/spec-v23: "Weekdays at 8:00 AM", "Every 30 minutes"
    expect(scheduleWords({ kind: "cron", expr: "0 8 * * 1-5" })).toBe("Weekdays at 8:00 AM");
    expect(formWords(form({ repeat: "weekdays", time: "08:00" }))).toBe("Weekdays at 8:00 AM");
    expect(scheduleWords({ kind: "every", everyMs: 1_800_000 })).toBe("Every 30 minutes");
    expect(formWords(form({ repeat: "every", everyN: "30", everyUnit: "minutes" }))).toBe("Every 30 minutes");

    expect(scheduleWords({ kind: "cron", expr: "0 9 * * *" })).toBe("Every day at 9:00 AM");
    expect(scheduleWords({ kind: "cron", expr: "30 7 * * 0,6" })).toBe("Weekends at 7:30 AM");
    expect(scheduleWords({ kind: "cron", expr: "0 17 * * 5" })).toBe("Fridays at 5:00 PM");
    expect(scheduleWords({ kind: "cron", expr: "0 6 1 * *" })).toBe("Monthly on the 1st at 6:00 AM");
    expect(scheduleWords({ kind: "every", everyMs: 60_000 })).toBe("Every minute");
    expect(scheduleWords({ kind: "on-exit", command: "backup" })).toBe("Runs when backup ends");
    expect(scheduleWords({ kind: "stream", command: ["tail", "-f", "log"] })).toBe("Runs on each line from tail -f log");
  });
});

describe("guessFromWords", () => {
  it("turns every friday at 5pm into the weekly form", () => {
    const guessed = guessFromWords("every friday at 5pm", NOW);
    expect(guessed.form).toMatchObject({ repeat: "weekly", weekday: 5, time: "17:00" });
  });
});

describe("health, failing and auto-disabled words", () => {
  const runs = (n: number, failed = 0) => Array.from({ length: n }, (_, i) => ({
    status: i < failed ? "error" : "ok",
    durationMs: 1000 + i * 10,
  }));

  it("reports an auto-disabled job in the preview's words", () => {
    // health15 / plurPD18 in design/spec-v23: "12 runs · all fine", "7 runs · 7 failed"
    // autoOffPD18 pill: "Turned itself off · N failed runs" / "Turned itself off · N schedule errors"
    expect(health([])).toBeNull();
    expect(health(runs(12))?.text).toBe("12 runs · all fine");
    expect(health(runs(12))?.warn).toBe(false);
    expect(health(runs(7, 7))?.text).toBe("7 runs · 7 failed");
    expect(health(runs(7, 7))?.warn).toBe(true);
    expect(health(runs(1))?.text).toBe("1 run · all fine");
    expect(health(runs(3))?.points).toBe("");
    expect(health(runs(8))?.points).toMatch(/^\d/);

    const off = { state: { autoDisabled: { reason: "consecutive-failures", consecutiveErrors: 10 } } };
    expect(autoDisabledWords(off)).toBe("Turned itself off · 10 failed runs");
    expect(failing(off)).toBe(true);
    expect(autoDisabledWords({
      state: { autoDisabled: { reason: "schedule-errors", consecutiveErrors: 1 } },
    })).toBe("Turned itself off · 1 schedule error");
    expect(autoDisabledWords({ state: {} })).toBeNull();
    expect(failing({ state: { lastRunStatus: "error" } })).toBe(true);
    expect(failing({ state: {} })).toBe(false);
  });
});

describe("invalid card input", () => {
  it("throws the card's own error words", () => {
    vi.setSystemTime(NOW);
    // pperr-* in design/spec-v23 propExtrasPD18 / ppLivePD18
    expect(() => formToSchedule(form({ repeat: "once", at: "" }), NOW)).toThrow("Enter a date and time that hasn’t passed.");
    expect(() => formToSchedule(form({ repeat: "once", at: "2026-01-01T09:00" }), NOW)).toThrow("Enter a date and time that hasn’t passed.");
    expect(() => formToSchedule(form({ repeat: "every", everyN: "0" }), NOW)).toThrow("Use a number above 0.");
    expect(() => formToSchedule(form({ repeat: "every", everyN: "nope" }), NOW)).toThrow("Use a number above 0.");
    expect(() => formToSchedule(form({ repeat: "custom", expr: "  " }), NOW)).toThrow("Write a cron line.");
    expect(() => formToSchedule(form({ repeat: "daily", time: "9:00" }), NOW)).toThrow("Choose a time.");
    expect(() => formToSchedule(form({ repeat: "daily", time: "09:00", tz: "Not/AZone" }), NOW)).toThrow("Choose a time zone this computer knows.");
    expect(() => formToSchedule(form({ repeat: "daily", time: "09:00", spreadN: "0" }), NOW)).toThrow("Use a number above 0.");
  });
});
