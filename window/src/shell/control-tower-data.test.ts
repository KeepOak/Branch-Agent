import { describe, expect, it } from "vitest";
import type { Conversation } from "../connect/conversations";
import {
  checkedLine,
  jobProgress,
  justEndedKeys,
  readCronJobs,
  readLocked,
  towerAccounts,
  towerChatter,
  towerClock,
  towerComingUp,
  towerFinished,
  towerHealth,
  towerNeeds,
  trunkList,
} from "./control-tower-data";
import { readLimits, usagePollResult } from "./status-data";

const NOW = new Date(2026, 9, 8, 12, 0).getTime();

function row(partial: Partial<Conversation> & Pick<Conversation, "key">): Conversation {
  return {
    title: partial.title ?? partial.key,
    isMain: false,
    pinned: false,
    archived: false,
    unread: false,
    snoozedUntil: null,
    createdAt: NOW - 60_000,
    updatedAt: NOW,
    preview: "",
    working: false,
    kind: "chat",
    system: false,
    automation: false,
    totalTokens: 0,
    contextTokens: 0,
    ...partial,
  };
}

describe("tower health (towerHtmlT5)", () => {
  it("says checking until a real result, then fine, warn, lockdown, or a failed check", () => {
    expect(towerHealth(false, false, null)).toEqual({ tone: "", text: "Checking every account…" });
    expect(towerHealth(false, false, null, true)).toEqual({ tone: "warn", text: "Couldn’t check accounts right now. Branch will try again." });
    const ok = readLimits({
      updatedAt: NOW,
      providers: [{ provider: "openai-codex", displayName: "ChatGPT plan", windows: [{ label: "5h", usedPercent: 23 }] }],
    }, NOW);
    expect(towerHealth(false, false, ok)).toEqual({ tone: "ok", text: "Everything is running fine." });
    const low = readLimits({
      updatedAt: NOW,
      providers: [{ provider: "openai-codex", displayName: "ChatGPT plan", windows: [{ label: "5h", usedPercent: 88 }] }],
    }, NOW);
    expect(towerHealth(false, false, low)).toEqual({ tone: "warn", text: "One account is nearly used up. Everything else is fine." });
    expect(towerHealth(true, false, low)).toEqual({ tone: "bad", text: "Lockdown is on. Trunks can only read." });
    expect(towerHealth(false, true, low)).toEqual({ tone: "", text: "Checking every account…" });
    expect(towerHealth(false, false, ok, true)).toEqual({ tone: "warn", text: "Couldn’t check accounts right now. Branch will try again." });
  });

  it("never says everything is running fine when no accounts are connected", () => {
    const empty = readLimits({ updatedAt: NOW, providers: [] }, NOW);
    expect(empty.rows).toEqual([]);
    expect(towerHealth(false, false, empty)).toEqual({ tone: "", text: "No accounts connected yet." });
    expect(towerHealth(false, false, empty).text).not.toBe("Everything is running fine.");
    expect(usagePollResult(new CustomEvent("branch:usage-checked", { detail: empty }))).toEqual(empty);
    expect(usagePollResult(new Event("branch:usage-checked"))).toBeNull();
  });
});

describe("tower accounts", () => {
  it("shows 5-hour left, reset and week left from usage.status", () => {
    const limits = readLimits({
      updatedAt: NOW - 4 * 60_000,
      providers: [{
        provider: "openai-codex",
        displayName: "ChatGPT plan",
        plan: "Plus",
        accountEmail: "ada@example.test",
        windows: [
          { label: "5h", usedPercent: 23, resetAt: new Date(2026, 9, 8, 18, 0).getTime() },
          { label: "Week", usedPercent: 41 },
        ],
      }],
    }, NOW);
    expect(towerAccounts(limits)[0]).toMatchObject({
      email: "ada@example.test",
      windowLabel: "5-hour",
      fiveLeft: 77,
      reset: "resets 6 PM",
      weekLeft: 59,
      heat: "",
      meter: 77,
    });
    expect(checkedLine(limits.updatedAt, NOW)).toBe("checked 4 min ago");
  });

  it("falls back to the first measured window when it is not 5-hour", () => {
    const limits = readLimits({
      updatedAt: NOW,
      providers: [{
        provider: "openai-codex",
        displayName: "ChatGPT plan",
        windows: [
          { label: "3h", usedPercent: 40, resetAt: new Date(2026, 9, 8, 15, 0).getTime() },
          { label: "Week", usedPercent: 20 },
        ],
      }],
    }, NOW);
    expect(towerAccounts(limits)[0]).toMatchObject({
      windowLabel: "3-hour",
      fiveLeft: 60,
      reset: "resets 3 PM",
      weekLeft: 80,
      meter: 60,
    });
  });
});

describe("Coming up", () => {
  it("keeps the next 3 enabled jobs, soonest first", () => {
    const jobs = [
      { id: "late", displayName: "Nightly backup check", enabled: true, agentId: "branch", state: { nextRunAtMs: NOW + 3 * 86_400_000 } },
      { id: "off", displayName: "Off", enabled: false, agentId: "scout", state: { nextRunAtMs: NOW + 1000 } },
      { id: "soon", displayName: "Weekday brief", enabled: true, agentId: "ada", schedule: { kind: "cron", expr: "30 7 * * 1-5" }, state: { nextRunAtMs: NOW + 12 * 60_000 } },
      { id: "mid", name: "Receipts sweep", enabled: true, agentId: "ledger", state: { nextRunAtMs: NOW + 2 * 60 * 60_000 } },
      { id: "fourth", name: "Too far", enabled: true, agentId: "field", state: { nextRunAtMs: NOW + 10 * 86_400_000 } },
    ];
    expect(towerComingUp(jobs, NOW).map((job) => job.name)).toEqual(["Weekday brief", "Receipts sweep", "Nightly backup check"]);
    expect(towerComingUp(jobs, NOW)[0]).toMatchObject({ trunkId: "ada" });
    expect(towerComingUp(jobs, NOW)[0]?.when).toMatch(/Weekdays at 7:30 AM/);
    expect(towerComingUp(jobs, NOW)[1]?.when).toBe("in 2 h");
  });
});

describe("Just finished and chatter", () => {
  it("adds run length and the time", () => {
    const rows = [
      row({ key: "agent:ledger:done", title: "September expense report", agentId: "ledger", done: true, updatedAt: NOW - 20 * 60_000 }),
      row({ key: "agent:ada:done", title: "Book the Lisbon trip", agentId: "ada", done: true, updatedAt: NOW - 90 * 60_000 }),
    ];
    const audit = {
      events: [
        { kind: "agent_run", runId: "r1", sessionKey: "agent:ledger:done", agentId: "ledger", action: "agent.run.started", occurredAt: NOW - 20 * 60_000 - 130_000 },
        { kind: "agent_run", runId: "r1", sessionKey: "agent:ledger:done", agentId: "ledger", action: "agent.run.finished", occurredAt: NOW - 20 * 60_000, status: "ok" },
      ],
    };
    const finished = towerFinished(rows, audit, NOW);
    expect(finished[0]).toMatchObject({ title: "September expense report", duration: "2m 10s" });
    expect(finished[0]?.when).toBeTruthy();
    expect(towerClock(NOW, NOW)).toBe("12 PM");
  });

  it("lists a finished run that was never marked done", () => {
    const rows = [
      row({ key: "agent:ada:task", title: "Tidy the Downloads folder", agentId: "ada", working: false, updatedAt: NOW }),
      row({ key: "agent:scout:idle", title: "Always idle", agentId: "scout", working: false }),
    ];
    const audit = {
      events: [
        { kind: "agent_run", runId: "r2", sessionKey: "agent:ada:task", agentId: "ada", action: "agent.run.started", occurredAt: NOW - 32_000 },
        { kind: "agent_run", runId: "r2", sessionKey: "agent:ada:task", agentId: "ada", action: "agent.run.finished", occurredAt: NOW, status: "ok" },
      ],
    };
    expect(towerFinished(rows, audit, NOW).map((item) => item.title)).toEqual(["Tidy the Downloads folder"]);
    expect(towerFinished(rows, audit, NOW)[0]).toMatchObject({ duration: "32s" });
    expect(towerFinished(rows, {}, NOW)).toEqual([]);
    expect(justEndedKeys(["agent:ada:task"], rows)).toEqual(["agent:ada:task"]);
    expect(justEndedKeys([], rows)).toEqual([]);
    expect(towerFinished(rows, {}, NOW, ["agent:ada:task"])[0]).toMatchObject({ title: "Tidy the Downloads folder" });
  });

  it("keeps group previews without inventing who spoke", () => {
    const lines = towerChatter([
      row({
        key: "agent:scout:room:r1",
        agentId: "scout",
        groupChat: true,
        preview: "Found the Hartwell invoice.",
        participantIds: ["scout", "ledger"],
      }),
    ]);
    expect(lines).toEqual([{ key: "agent:scout:room:r1", text: "Found the Hartwell invoice." }]);
  });

  it("reads a percent from a job headline", () => {
    expect(jobProgress("Copying the code · 42%")).toBe(42);
    expect(jobProgress("Working")).toBeNull();
  });
});

describe("Needs you", () => {
  it("lists real approvals, pending questions and needsYou rows, and never invents extras", () => {
    const name = (id?: string) => (id === "ada" ? "Ada" : id === "ledger" ? "Ledger" : id ?? "");
    const items = towerNeeds(
      [
        row({ key: "agent:ada:wait", title: "Tidy the Downloads folder", agentId: "ada", needsYou: true, headline: "Which folder first?" }),
        row({ key: "agent:ledger:ask", title: "September expense report", agentId: "ledger", needsYou: true, preview: "Send Dana the report?" }),
        row({ key: "agent:ada:idle", title: "Idle", agentId: "ada" }),
      ],
      [{ id: "ex1", kind: "exec", request: { title: "Run tidy.sh", agentId: "ada", sessionKey: "agent:ada:wait", description: "exec" } }],
      [{ id: "q1", status: "pending", agentId: "ledger", sessionKey: "agent:ledger:ask", questions: [{ questionId: "send", question: "Send Dana the report?", header: "Email" }] }],
      name,
    );
    expect(items.map((item) => [item.kind, item.title, item.who])).toEqual([
      ["approval", "Run tidy.sh", "Ada"],
      ["question", "Send Dana the report?", "Ledger"],
    ]);
    expect(towerNeeds([row({ key: "agent:ada:wait", agentId: "ada", needsYou: true, headline: "Which folder first?" })], [], [], name)).toEqual([
      expect.objectContaining({ id: "waiting:agent:ada:wait", kind: "waiting", title: "Which folder first?", who: "Ada" }),
    ]);
    expect(towerNeeds([row({ key: "agent:ada:idle", agentId: "ada" })], [], [], name)).toEqual([]);
  });
});

describe("engine snapshots", () => {
  it("reads lockdown, cron jobs and trunk names", () => {
    expect(readLocked({ config: { security: { lockdown: true } } })).toBe(true);
    expect(readCronJobs({ jobs: [{ id: "a" }] })).toHaveLength(1);
    expect(trunkList({ defaultId: "ada", agents: [{ id: "ada", identity: { name: "Ada" } }] }).list[0]).toEqual({ id: "ada", name: "Ada" });
  });
});
