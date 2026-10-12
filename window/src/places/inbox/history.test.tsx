import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarBins, hourBins } from "./History";

afterEach(() => vi.unstubAllEnvs());

describe("History Pulse local calendar days", () => {
  it.each([
    ["2026-03-09T12:00:00-04:00", "2026-03-08T00:00:00-05:00", 23],
    ["2026-11-02T12:00:00-05:00", "2026-11-01T00:00:00-04:00", 25],
  ])("counts every local boundary once around %s", (now, transition, hours) => {
    vi.stubEnv("TZ", "America/New_York");
    const bins = calendarBins(new Date(now), 7);
    const day = bins.find(([start]) => start.getTime() === new Date(transition).getTime())!;
    expect((day[1].getTime() - day[0].getTime()) / 36e5).toBe(hours);
    for (let i = 1; i < bins.length; i++) {
      const boundary = bins[i][0];
      expect(bins[i - 1][1].getTime()).toBe(boundary.getTime());
      expect(bins.filter(([start, end]) => boundary >= start && boundary < end)).toHaveLength(1);
    }
  });
});

describe("History Pulse elapsed hours", () => {
  it.each([
    ["2026-03-08T03:30:00-04:00", "2026-03-08T03:00:00-04:00"],
    ["2026-11-01T01:30:00-05:00", "2026-11-01T01:00:00-05:00"],
  ])("keeps 24 distinct hours around %s", (now, currentHour) => {
    vi.stubEnv("TZ", "America/New_York");
    const bins = hourBins(new Date(now));
    expect(bins).toHaveLength(24);
    expect(bins.at(-1)![0].getTime()).toBe(new Date(currentHour).getTime());
    expect(new Set(bins.map(([start]) => start.getTime())).size).toBe(24);
    for (let i = 0; i < bins.length; i++) {
      const [start, end] = bins[i];
      expect(end.getTime() - start.getTime()).toBe(36e5);
      if (i) expect(bins[i - 1][1].getTime()).toBe(start.getTime());
      const midpoint = new Date(start.getTime() + 18e5);
      expect(bins.filter(([a, b]) => midpoint >= a && midpoint < b)).toHaveLength(1);
    }
  });
});
