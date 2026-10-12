import { expect, it } from "vitest";
import { claudeCodeUsageWindows } from "./usage-claude-code.js";

it("reads Claude Code control-channel five-hour and weekly limits", () => {
  expect(claudeCodeUsageWindows(JSON.stringify({ type: "control_response", response: {
    request_id: "branch-usage", subtype: "success", response: { rate_limits: {
      five_hour: { utilization: 35, resets_at: "2026-10-05T20:00:00Z" },
      seven_day: { utilization: 68, resets_at: "2026-10-11T20:00:00Z" },
    } },
  } }))).toEqual([
    { label: "5 hours", usedPercent: 35, resetAt: Date.parse("2026-10-05T20:00:00Z") },
    { label: "Week", usedPercent: 68, resetAt: Date.parse("2026-10-11T20:00:00Z") },
  ]);
});
