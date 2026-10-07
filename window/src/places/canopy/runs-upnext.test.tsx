// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { CanopyData } from "./data";
import { buildRuns } from "./runs";
import type { Row } from "../automations/runtime";

const now = Date.now();

function makeCanopyData(jobs: Row[]): CanopyData {
  return {
    sessions: [],
    pending: [],
    jobs,
    runs: [],
    cards: [],
    boards: [],
    trunks: [{ id: "trunk-a", name: "Oak" }],
    defaultTrunk: "trunk-a",
    mainKey: "main",
    nodes: [],
    computer: null,
    cardsError: "",
    errors: [],
    viewer: "",
  };
}

describe("nextRuns filtering", () => {
  it("shows user jobs in Up next and hides system jobs", () => {
    const jobs: Row[] = [
      {
        id: "user-job-1",
        name: "Morning report",
        displayName: "Morning report",
        description: "Daily summary",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "",
        state: { nextRunAtMs: now + 300000 },
      },
      {
        id: "system-heartbeat",
        name: "heartbeat-trunk-a",
        displayName: "Heartbeat (trunk-a)",
        description: "System check-in",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "heartbeat:trunk-a",
        state: { nextRunAtMs: now + 60000 },
      },
      {
        id: "system-skill-review",
        name: "skill-collection-review",
        displayName: "Skill collection review",
        description: "Review skill updates",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "skill-collection-review:daily",
        state: { nextRunAtMs: now + 120000 },
      },
      {
        id: "user-job-2",
        name: "Evening summary",
        displayName: "Evening summary",
        description: "End of day report",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "",
        state: { nextRunAtMs: now + 600000 },
      },
      {
        id: "system-heartbeat-task",
        name: "heartbeat-task-imported",
        displayName: "Heartbeat task",
        description: "Imported heartbeat task",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "heartbeat-task:imported",
        state: { nextRunAtMs: now + 180000 },
      },
    ];

    const data = makeCanopyData(jobs);
    const runs = buildRuns(data, now);
    const upNext = runs.filter(r => r.col === "next" && r.kind === "sched");

    expect(upNext).toHaveLength(2);
    expect(upNext.map(r => r.task)).toEqual(["Morning report", "Evening summary"]);
    expect(upNext.every(r => r.job && !String(r.job.declarationKey || "").match(/^(heartbeat|heartbeat-task|skill-collection-review):/))).toBe(true);
  });

  it("sorts user jobs by next run time", () => {
    const jobs: Row[] = [
      {
        id: "user-job-later",
        name: "Later job",
        displayName: "Later job",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "",
        state: { nextRunAtMs: now + 900000 },
      },
      {
        id: "user-job-soon",
        name: "Soon job",
        displayName: "Soon job",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "",
        state: { nextRunAtMs: now + 100000 },
      },
      {
        id: "system-heartbeat",
        name: "heartbeat",
        displayName: "Heartbeat",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "heartbeat:trunk-a",
        state: { nextRunAtMs: now + 50000 },
      },
    ];

    const data = makeCanopyData(jobs);
    const runs = buildRuns(data, now);
    const upNext = runs.filter(r => r.col === "next" && r.kind === "sched");

    expect(upNext).toHaveLength(2);
    expect(upNext[0].task).toBe("Soon job");
    expect(upNext[1].task).toBe("Later job");
    expect(upNext[0].at).toBeLessThan(upNext[1].at!);
  });

  it("filters out disabled system jobs", () => {
    const jobs: Row[] = [
      {
        id: "disabled-heartbeat",
        name: "heartbeat-disabled",
        displayName: "Heartbeat (disabled)",
        enabled: false,
        agentId: "trunk-a",
        declarationKey: "heartbeat:trunk-a",
        state: { nextRunAtMs: now + 60000 },
      },
      {
        id: "user-job",
        name: "User job",
        displayName: "User job",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "",
        state: { nextRunAtMs: now + 300000 },
      },
    ];

    const data = makeCanopyData(jobs);
    const runs = buildRuns(data, now);
    const upNext = runs.filter(r => r.col === "next" && r.kind === "sched");

    expect(upNext).toHaveLength(1);
    expect(upNext[0].task).toBe("User job");
  });

  it("filters jobs with no next run time", () => {
    const jobs: Row[] = [
      {
        id: "no-next-run",
        name: "No next run",
        displayName: "No next run",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "",
        state: { nextRunAtMs: 0 },
      },
      {
        id: "has-next-run",
        name: "Has next run",
        displayName: "Has next run",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "",
        state: { nextRunAtMs: now + 300000 },
      },
    ];

    const data = makeCanopyData(jobs);
    const runs = buildRuns(data, now);
    const upNext = runs.filter(r => r.col === "next" && r.kind === "sched");

    expect(upNext).toHaveLength(1);
    expect(upNext[0].task).toBe("Has next run");
  });

  it("filters running jobs", () => {
    const jobs: Row[] = [
      {
        id: "running-job",
        name: "Running job",
        displayName: "Running job",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "",
        state: { nextRunAtMs: now + 300000, runningAtMs: now },
      },
      {
        id: "waiting-job",
        name: "Waiting job",
        displayName: "Waiting job",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "",
        state: { nextRunAtMs: now + 300000 },
      },
    ];

    const data = makeCanopyData(jobs);
    const runs = buildRuns(data, now);
    const upNext = runs.filter(r => r.col === "next" && r.kind === "sched");

    expect(upNext).toHaveLength(1);
    expect(upNext[0].task).toBe("Waiting job");
  });

  it("handles jobs without declarationKey gracefully", () => {
    const jobs: Row[] = [
      {
        id: "no-declaration-key",
        name: "No declaration key",
        displayName: "No declaration key",
        enabled: true,
        agentId: "trunk-a",
        state: { nextRunAtMs: now + 300000 },
      },
      {
        id: "empty-declaration-key",
        name: "Empty declaration key",
        displayName: "Empty declaration key",
        enabled: true,
        agentId: "trunk-a",
        declarationKey: "",
        state: { nextRunAtMs: now + 400000 },
      },
    ];

    const data = makeCanopyData(jobs);
    const runs = buildRuns(data, now);
    const upNext = runs.filter(r => r.col === "next" && r.kind === "sched");

    expect(upNext).toHaveLength(2);
    expect(upNext[0].task).toBe("No declaration key");
    expect(upNext[1].task).toBe("Empty declaration key");
  });
});
