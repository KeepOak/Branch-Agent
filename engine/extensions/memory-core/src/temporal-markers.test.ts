// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421
// packages/memory/src/processors/observational-memory/__tests__/temporal-markers.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaptureHarness } from "./capture-registration.test-support.js";
import {
  buildTemporalGapReminder,
  formatTemporalGap,
  formatTemporalTimestamp,
} from "./temporal-markers.js";

describe("temporal markers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats temporal gaps using two-unit durations", () => {
    expect(formatTemporalGap(10 * 60 * 1000 - 1)).toBeNull();
    const cases = [
      { diffMs: 10 * 60 * 1000, expected: "10 minutes later" },
      { diffMs: 15 * 60 * 1000, expected: "15 minutes later" },
      { diffMs: 30 * 60 * 1000, expected: "30 minutes later" },
      { diffMs: 45 * 60 * 1000, expected: "45 minutes later" },
      { diffMs: 60 * 60 * 1000, expected: "1 hour later" },
      { diffMs: 60 * 60 * 1000 + 26 * 60 * 1000, expected: "1 hour 26 minutes later" },
      { diffMs: 6 * 60 * 60 * 1000 + 44 * 60 * 1000, expected: "6 hours 44 minutes later" },
      { diffMs: 24 * 60 * 60 * 1000, expected: "1 day later" },
      { diffMs: 24 * 60 * 60 * 1000 + 13 * 60 * 60 * 1000, expected: "1 day 13 hours later" },
      { diffMs: 7 * 24 * 60 * 60 * 1000, expected: "1 week later" },
      { diffMs: 7 * 24 * 60 * 60 * 1000 + 3 * 24 * 60 * 60 * 1000, expected: "1 week 3 days later" },
      { diffMs: 30 * 24 * 60 * 60 * 1000, expected: "1 month later" },
      {
        diffMs: 30 * 24 * 60 * 60 * 1000 + 14 * 24 * 60 * 60 * 1000,
        expected: "1 month 2 weeks later",
      },
      { diffMs: 365 * 24 * 60 * 60 * 1000, expected: "1 year later" },
      {
        diffMs: 365 * 24 * 60 * 60 * 1000 + 60 * 24 * 60 * 60 * 1000,
        expected: "1 year 2 months later",
      },
    ];
    for (const { diffMs, expected } of cases) {
      expect(formatTemporalGap(diffMs)).toBe(expected);
    }
  });

  it("labels the reported db fixture gap honestly", () => {
    expect(formatTemporalGap(40433500)).toBe("11 hours 13 minutes later");
  });

  it("builds a gap reminder from the previous message timestamp", () => {
    const now = Date.parse("2025-01-01T08:50:00.000Z");
    const reminder = buildTemporalGapReminder({
      messages: [
        { role: "user", content: "First history message", timestamp: Date.parse("2025-01-01T08:00:00.000Z") },
        { role: "assistant", content: "Second", timestamp: Date.parse("2025-01-01T08:20:00.000Z") },
      ],
      now,
    });
    const expectedTimestamp = formatTemporalTimestamp(new Date("2025-01-01T08:50:00Z"));
    expect(reminder).toBe(
      `<system-reminder type="temporal-gap">30 minutes later — ${expectedTimestamp}</system-reminder>`,
    );
    expect(
      buildTemporalGapReminder({
        messages: [{ role: "user", timestamp: Date.parse("2025-01-01T08:45:00.000Z") }],
        now,
      }),
    ).toBeUndefined();
    expect(buildTemporalGapReminder({ messages: [], now })).toBeUndefined();
  });

  it("measures from the previous turn when a retried attempt already holds the current message", () => {
    const now = Date.parse("2025-01-01T08:50:00.000Z");
    const reminder = buildTemporalGapReminder({
      messages: [
        { role: "assistant", content: "Earlier", timestamp: Date.parse("2025-01-01T08:20:00.000Z") },
        { role: "user", content: [{ type: "text", text: "Current user message" }], timestamp: now },
      ],
      currentPrompt: "Current user message",
      now,
    });
    expect(reminder).toContain("30 minutes later");
  });

  it("adds the marker to user turns only when temporalMarkers is on", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-01-02T09:00:00.000Z"));
    const messages = [{ role: "assistant", content: "bye", timestamp: Date.parse("2025-01-01T21:00:00.000Z") }];
    const off = createCaptureHarness({ workspaceDir: "/unused" });
    expect(
      await off.hook("before_prompt_build")({ prompt: "hi", messages }, { agentId: "main", trigger: "user" }),
    ).toBeUndefined();
    const on = createCaptureHarness({ workspaceDir: "/unused", pluginConfig: { temporalMarkers: true } });
    const userTurn = (await on.hook("before_prompt_build")(
      { prompt: "hi", messages },
      { agentId: "main", trigger: "user" },
    )) as { prependContext?: string };
    expect(userTurn.prependContext).toContain('<system-reminder type="temporal-gap">12 hours later');
    expect(
      await on.hook("before_prompt_build")({ prompt: "hi", messages }, { agentId: "main", trigger: "heartbeat" }),
    ).toBeUndefined();
  });
});
