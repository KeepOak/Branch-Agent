import { describe, expect, it } from "vitest";
import { accountEmails, comingUp, dueWords, planWords, readLimits, readRoom, readRounds, resetWords, ringReading, SIGN_IN_AGAIN_WORDS, sizeWords, uptimeWords, usagePollResult, windowName, withAccountEmails } from "./status-data";
import { usageWords } from "./StatusBar";

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
    expect(l.rows[0]).toMatchObject({ name: "ChatGPT · Account 1", account: "a@b.c · Plus", pill: "Measured", line: "as of 4 min ago" });
    expect(l.rows[0].windows).toEqual([
      { name: "This 5-hour window", left: 12, reset: "resets 6 PM", low: true },
      { name: "This week", left: 64, reset: "resets 9 AM Mon", low: false },
    ]);
    expect(l.rows[1]).toMatchObject({ pill: "Not published", line: "Google Gemini hasn't shared a limit with Branch." });
    expect(l.rows[2].line).toBe("X needs you to sign in again to check usage.");
  });
  it("turns Claude rate limits into status words without showing the engine error", () => {
    const row = readLimits({ providers: [{ provider: "anthropic", displayName: "Claude", windows: [], error: "HTTP 429: Rate limited. Please try again later." }] }, NOW).rows[0];
    expect(row.line).toBe("Claude didn't share what's left right now. Branch checks again in 5 min.");
  });
  it("numbers each Claude subscription and says so in plain words when it shares no number", () => {
    const rows = readLimits({ updatedAt: NOW, providers: [
      { provider: "anthropic", displayName: "Claude", authProfileId: "anthropic:one", plan: "Max (20x)", windows: [{ label: "5h", usedPercent: 25, resetAt: new Date(2026, 9, 2, 15, 0).getTime() }] },
      { provider: "anthropic", displayName: "Claude", authProfileId: "anthropic:two", windows: [] },
    ] }, NOW).rows;
    expect(rows.map((row) => row.name)).toEqual(["Claude · Account 1", "Claude · Account 2"]);
    expect(rows[0].windows).toEqual([{ name: "This 5-hour window", left: 75, reset: "resets 3 PM", low: false }]);
    expect(rows[1]).toMatchObject({ pill: "Not published", line: "Claude hasn't shared a limit with Branch." });
  });
  it("dates a reading kept through a rate limit or timeout by its own age, not the reply's", () => {
    const rows = readLimits({ updatedAt: NOW, providers: [
      { provider: "anthropic", displayName: "Claude", authProfileId: "anthropic:one", windows: [{ label: "5h", usedPercent: 25 }], readingAt: NOW - 3 * 3_600_000, staleReason: "HTTP 429: Rate limited. Please try again later." },
      { provider: "anthropic", displayName: "Claude", authProfileId: "anthropic:two", windows: [{ label: "5h", usedPercent: 25 }], readingAt: NOW - 7 * 60_000, staleReason: "Timeout" },
      { provider: "anthropic", displayName: "Claude", authProfileId: "anthropic:three", windows: [{ label: "5h", usedPercent: 25 }] },
    ] }, NOW).rows;
    expect(rows.map((row) => [row.stale, row.line])).toEqual([
      [true, "Rate limited · last reading 3 h ago. Branch checks again in 5 min."],
      [true, "No answer · last reading 7 min ago. Branch will try again."],
      [undefined, "as of just now"],
    ]);
  });
  it("the ring prefers the account used next, then the first measured account", () => {
    expect(ringReading(readLimits(result, NOW))).toEqual({ name: "ChatGPT · Account 1", email: "a@b.c", left: 12, reset: "resets 6 PM", low: true });
    const usedNext = {
      updatedAt: NOW,
      providers: [
        { provider: "openai-codex", displayName: "ChatGPT plan", plan: "Plus", accountEmail: "a@b.c", windows: [{ label: "5h", usedPercent: 88, resetAt: new Date(2026, 9, 2, 18, 0).getTime() }] },
        { provider: "anthropic", displayName: "Claude", plan: "Max", accountEmail: "c@d.e", inUse: true, windows: [{ label: "5h", usedPercent: 40, resetAt: new Date(2026, 9, 2, 15, 0).getTime() }] },
      ],
    };
    expect(ringReading(readLimits(usedNext, NOW))).toEqual({ name: "Claude · Account 1", email: "c@d.e", left: 60, reset: "resets 3 PM", low: false });
    expect(ringReading(readLimits({ providers: [] }, NOW))).toBeNull();
    expect(ringReading(null)).toBeNull();
    const empty = readLimits({ providers: [] }, NOW);
    expect(usagePollResult(new CustomEvent("branch:usage-checked", { detail: empty }))).toEqual(empty);
    expect(usagePollResult(new Event("branch:usage-checked"))).toBeNull();
  });
  it("the ring shows the used-next account as unknown when it has no reading, never another account's number", () => {
    const usedNextEmpty = {
      updatedAt: NOW,
      providers: [
        { provider: "openai-codex", displayName: "ChatGPT plan", plan: "Plus", accountEmail: "a@b.c", windows: [{ label: "5h", usedPercent: 88, resetAt: new Date(2026, 9, 2, 18, 0).getTime() }] },
        { provider: "anthropic", displayName: "Claude", plan: "Max", accountEmail: "c@d.e", inUse: true, windows: [] },
      ],
    };
    expect(ringReading(readLimits(usedNextEmpty, NOW))).toEqual({ name: "Claude · Account 1", email: "c@d.e", left: null, reset: "", low: false });
    const usedNextWins = {
      updatedAt: NOW,
      providers: [
        { provider: "openai-codex", displayName: "ChatGPT plan", plan: "Plus", accountEmail: "a@b.c", windows: [{ label: "5h", usedPercent: 88, resetAt: new Date(2026, 9, 2, 18, 0).getTime() }] },
        { provider: "anthropic", displayName: "Claude", plan: "Max", accountEmail: "c@d.e", inUse: true, windows: [{ label: "5h", usedPercent: 40, resetAt: new Date(2026, 9, 2, 15, 0).getTime() }] },
      ],
    };
    expect(ringReading(readLimits(usedNextWins, NOW))).toEqual({ name: "Claude · Account 1", email: "c@d.e", left: 60, reset: "resets 3 PM", low: false });
    const noneMeasured = {
      updatedAt: NOW,
      providers: [
        { provider: "anthropic", displayName: "Claude", inUse: true, windows: [] },
        { provider: "google", displayName: "Google Gemini", windows: [] },
      ],
    };
    expect(ringReading(readLimits(noneMeasured, NOW))).toEqual({ name: "Claude · Account 1", left: null, reset: "", low: false });
    const nothingMeasured = { updatedAt: NOW, providers: [{ provider: "anthropic", displayName: "Claude", windows: [] }] };
    expect(ringReading(readLimits(nothingMeasured, NOW))).toBeNull();
  });
  it("window names and resets", () => {
    expect(windowName("3h")).toBe("This 3-hour window");
    expect(windowName("Day")).toBe("Today");
    expect(windowName("Opus")).toBe("Opus");
    expect(resetWords(undefined, 0, NOW)).toBe("not used yet");
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
  it("uptime words", () => {
    expect(uptimeWords((3 * 24 + 4) * 3_600_000)).toBe("3 days, 4 hours");
    expect(uptimeWords(90_000)).toBe("1 minute");
  });
  it("plan ids read as the plan a person knows, and an account takes its email from its saved profile", () => {
    expect(planWords("openai-codex", "prolite")).toBe("ChatGPT Pro Lite");
    expect(planWords("openai-codex", "pro")).toBe("ChatGPT Pro");
    expect(planWords("openai-codex", "plus")).toBe("ChatGPT Plus");
    expect(planWords("openai-codex", "")).toBe("");
    expect(planWords("anthropic", "max")).toBe("Claude Max");
    expect(planWords("anthropic", "Max (20x)")).toBe("Claude Max (20x)");
    expect(planWords("anthropic", "Claude Pro")).toBe("Claude Pro");
    const usage = { updatedAt: NOW, providers: [
      { provider: "anthropic", displayName: "Claude", authProfileId: "anthropic:one", plan: "max", windows: [{ label: "5h", usedPercent: 20, resetAt: NOW + 3_600_000 }] },
      { provider: "anthropic", displayName: "Claude", authProfileId: "anthropic:two", plan: "max", windows: [] },
    ] };
    const emails = accountEmails({ providers: [{ provider: "anthropic", profiles: [{ profileId: "anthropic:one", email: "one@example.com" }, { profileId: "anthropic:two" }] }] });
    expect([...emails]).toEqual([["anthropic:one", "one@example.com"]]);
    const named = withAccountEmails(readLimits(usage, NOW), emails);
    expect(named.rows.map((row) => row.email)).toEqual(["one@example.com", undefined]);
    expect(named.rows[0].plan).toBe("Claude Max");
    expect(withAccountEmails(readLimits(usage, NOW), new Map())).toEqual(readLimits(usage, NOW));
  });
  it("the bottom bar names the account used next by email, with its share left and reset, or says usage is unknown", () => {
    expect(usageWords({ name: "Claude · Account 1", email: "one@example.com", left: 60, reset: "resets 3 PM", low: false })).toBe("one@example.com · 60% left · resets 3 PM");
    expect(usageWords({ name: "Claude · Account 2", email: "two@example.com", left: null, reset: "", low: false })).toBe("two@example.com · usage unknown");
    expect(usageWords({ name: "ChatGPT · Account 1", left: 12, reset: "", low: true })).toBe("ChatGPT · Account 1 · 12% left");
    expect(usageWords(null)).toBe("Usage");
  });
  it("a token without the usage scope asks for a sign-in in plain words, never the raw HTTP error", () => {
    const limits = readLimits({ updatedAt: NOW, providers: [
      { provider: "anthropic", displayName: "Claude", authProfileId: "anthropic:one", plan: "max", signInNeeded: true, error: "HTTP 403: OAuth token does not meet scope requirement user:profile" },
      { provider: "anthropic", displayName: "Claude", authProfileId: "anthropic:two", plan: "max", error: "HTTP 429: Rate limited. Please try again later." },
    ] }, NOW);
    expect(limits.rows[0]).toMatchObject({ signInNeeded: true, line: SIGN_IN_AGAIN_WORDS });
    expect(limits.rows[0].line).not.toMatch(/HTTP|scope/);
    expect(limits.rows[1].signInNeeded).toBeUndefined();
    expect(limits.rows[1].line).toBe("Claude didn't share what's left right now. Branch checks again in 5 min.");
  });
});
