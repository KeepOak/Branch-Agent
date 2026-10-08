// Ported from bytedance/deer-flow f840e843d3e2db1485cb65ceae73a5525aa80193,
// deerflow/community/search_time_range.py. Sofya sends these values unchanged.
export const SEARCH_TIME_RANGES = ["day", "week", "month", "year"] as const;
export type SearchTimeRange = (typeof SEARCH_TIME_RANGES)[number];

export function readSearchTimeRange(value: unknown): SearchTimeRange | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!SEARCH_TIME_RANGES.includes(value as SearchTimeRange)) {
    throw new Error("time_range must be day, week, month or year");
  }
  return value as SearchTimeRange;
}
