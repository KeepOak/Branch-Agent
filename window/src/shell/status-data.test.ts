import { describe, expect, it } from "vitest";
import { comingUp, dueWords, limitsSummary, monthParams, readLimits, readMonthSpend, readRoom, readRounds, readUpdate, resetWords, ringReading, sizeWords, uptimeWords, windowName } from "./status-data";

const NOW = new Date(2026, 9, 2, 12, 0).getTime();

describe("usage.status (§4.9.4)", () => {
  const result = {
    updatedAt: NOW - 4 * 60_000,
    providers: [
      { provider: "openai-codex", displayName: "ChatGPT plan", plan: "Plus", accountEmail: "a@b.c", windows: [{ label: "5h", usedPercent: 88, resetAt: new Date(2026, 9, 2, 18, 0).getTime() }, { label: "Week", usedPercent: 36, resetAt: new Date(2026, 9, 5, 9, 0).getTime() }] },
      { provider: "google", displayName: "Google Gemini", windows: [] },
      { provider: "x", displayName: "X", windows: [], error: "Token expired" },
    ],
  };
  it("one row per account with the spec's window words and pills", () => {
    const l = readLimits(result, NOW);
    expect(l.rows[0]).toMatchObject({ name: "ChatGPT plan", account: "a@b.c · Plus", pill: "Measured", line: "as of 4 min ago" });
    expect(l.rows[0].windows).toEqual([
      { name: "This 5-hour window", left: 12, reset: "resets at 6 pm", low: true },
      { name: "This week", left: 64, reset: "resets Monday", low: false },
    ]);
    expect(l.rows[1]).toMatchObject({ pill: "Not published", line: "This service does not say what it allows." });
    expect(l.rows[2].line).toBe("Token expired");
    expect(limitsSummary(l.rows)).toBe("1 of 3 connections report a limit. The other 2 do not publish one. Accounts are never added together.");
  });
  it("the ring shows the window with the least left, and nothing without a reading", () => {
    expect(ringReading(readLimits(result, NOW))).toEqual({ name: "ChatGPT plan", left: 12, reset: "resets at 6 pm", low: true });
    expect(ringReading(readLimits({ providers: [] }, NOW))).toBeNull();
    expect(ringReading(null)).toBeNull();
  });
  it("window names and resets", () => {
    expect(windowName("3h")).toBe("This 3-hour window");
    expect(windowName("Day")).toBe("Today");
    expect(windowName("Opus")).toBe("Opus");
    expect(resetWords(undefined, 0, NOW)).toBe("full");
  });
});

describe("usage.cost this month", () => {
  it("asks from the 1st to today and reads the total", () => {
    expect(monthParams(new Date(2026, 9, 2))).toMatchObject({ startDate: "2026-10-01", endDate: "2026-10-02", mode: "specific", agentScope: "all" });
    expect(readMonthSpend({ totals: { totalCost: 14.2 } })).toBe("$14.20");
    expect(readMonthSpend({})).toBeNull();
  });
});

describe("Room left (§4.9.5)", () => {
  const usage = {
    sessions: [
      {
        contextWeight: {
          systemPrompt: { chars: 40_000 },
          skills: { promptChars: 8_000, entries: [{ name: "pdf", blockChars: 8_000 }] },
          tools: { listChars: 4_000, schemaChars: 16_000, entries: [] },
          injectedWorkspaceFiles: [{ name: "AGENTS.md", injectedChars: 8_000 }, { name: "x", injectedChars: null, injectionStatus: "native_unverified" }],
        },
      },
    ],
  };
  it("splits the window by part the way the Control UI does", () => {
    const room = readRoom(50_000, 100_000, usage);
    expect(room?.free).toBe(50);
    expect(room?.parts.map((p) => [p.name, p.share])).toEqual([
      ["Conversation", 36],
      ["Instructions", 5],
      ["Skills", 2],
      ["Tools", 5],
      ["Files", 2],
    ]);
  });
  it("is null until the engine has measured it, and has no parts without a context report", () => {
    expect(readRoom(0, 100_000, usage)).toBeNull();
    expect(readRoom(10_000, 100_000, {})?.parts).toEqual([]);
  });
  it("rounds and the cache share", () => {
    expect(readRounds({ points: [{ totalTokens: 100, input: 20, cacheRead: 60 }, { totalTokens: 50, input: 20, cacheRead: 0 }] })).toEqual({
      rounds: [{ words: 100, cached: 60 }, { words: 50, cached: 0 }],
      cachedShare: 60,
    });
    expect(sizeWords(256_000)).toBe("256K");
  });
});

describe("Running and version", () => {
  it("Coming up: enabled jobs with a next run, soonest first", () => {
    const jobs = [
      { name: "late", enabled: true, state: { nextRunAtMs: NOW + 3 * 86_400_000 } },
      { name: "off", enabled: false, state: { nextRunAtMs: NOW + 1000 } },
      { name: "soon", enabled: true, state: { nextRunAtMs: NOW + 12 * 60_000 } },
      { name: "never", enabled: true, state: {} },
    ];
    expect(comingUp(jobs, NOW)).toEqual([{ name: "soon", when: "in 12 min" }, { name: "late", when: "in 3 days" }]);
    expect(dueWords(NOW - 5, NOW)).toBe("due");
  });
  it("update.status: the waiting version and its commits", () => {
    expect(readUpdate({ updateAvailable: { currentVersion: "1.0.0", latestVersion: "1.1.0", channel: "stable", commits: [{ sha: "a", subject: "Faster start" }] } }, "1.0.0")).toEqual({
      current: "1.0.0",
      latest: "1.1.0",
      notes: ["Faster start"],
      installing: false,
      waiting: null,
    });
    expect(readUpdate({ updateAvailable: null }, "1.0.0").latest).toBeNull();
  });
  it("uptime words", () => {
    expect(uptimeWords((3 * 24 + 4) * 3_600_000)).toBe("3 days, 4 hours");
    expect(uptimeWords(90_000)).toBe("1 minute");
  });
});
