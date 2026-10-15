import { expect, it } from "vitest";
import { parseAnthropicUsageHeaders } from "./anthropic-usage.js";
it("maps unified subscription utilization and reset seconds without retaining unrelated headers", () => {
  expect(
    parseAnthropicUsageHeaders({
      "anthropic-ratelimit-unified-5h-utilization": "0.25",
      "anthropic-ratelimit-unified-5h-reset": "1800000000",
      "anthropic-ratelimit-unified-7d-utilization": "0.6",
      "anthropic-ratelimit-unified-7d-reset": "1800500000",
      authorization: "fixture-not-persisted",
    }),
  ).toEqual([
    { label: "5h", usedPercent: 25, resetAt: 1800000000000 },
    { label: "Week", usedPercent: 60, resetAt: 1800500000000 },
  ]);
});
it("does not turn absent or invalid usage into an empty allowance", () => {
  expect(parseAnthropicUsageHeaders({})).toEqual([]);
  expect(
    parseAnthropicUsageHeaders({ "anthropic-ratelimit-unified-5h-utilization": "NaN" }),
  ).toEqual([]);
});
