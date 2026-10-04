import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarBins } from "./History";

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
