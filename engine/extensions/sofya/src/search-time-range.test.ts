import { expect, it } from "vitest";
import { readSearchTimeRange, SEARCH_TIME_RANGES } from "./search-time-range.js";
it.each(SEARCH_TIME_RANGES)("preserves pinned Sofya freshness %s", (range) => {
  expect(readSearchTimeRange(range)).toBe(range);
});
it("omits absent filters and rejects unsupported ranges", () => {
  expect(readSearchTimeRange(undefined)).toBeUndefined();
  expect(readSearchTimeRange(null)).toBeUndefined();
  expect(() => readSearchTimeRange("hour")).toThrow("time_range");
});
