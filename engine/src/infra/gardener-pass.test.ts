import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addQueueItem, listQueueItems } from "../agents/trunk-queue.js";
import type { BranchConfig } from "../config/types.branch.js";
import { AgentsSchema } from "../config/zod-schema.agents.js";
import {
  resetGardenerStateForTests,
  resolveGardenerConfig,
  runGardenerPass,
  type GardenerInputs,
  type GardenerIssueDraft,
} from "./gardener-pass.js";

const MINUTE = 60_000;
const START = Date.parse("2026-10-10T12:00:00Z");
const REPO = "example-owner/example-repo";

const enabledCfg = { agents: { gardener: { enabled: true, repo: REPO } } } as BranchConfig;
const disabledWithRepoCfg = {
  agents: { gardener: { enabled: false, repo: REPO } },
} as BranchConfig;
const enabledNoRepoCfg = { agents: { gardener: { enabled: true } } } as BranchConfig;

const failingMain: GardenerInputs = {
  ciRuns: [
    {
      workflow_id: 7,
      name: "Engine tests",
      head_branch: "main",
      conclusion: "failure",
      created_at: "2026-10-10T11:00:00Z",
      html_url: `https://github.com/${REPO}/actions/runs/1`,
    },
  ],
};
const parityGap: GardenerInputs = { parityGaps: [{ key: "skills-ui", summary: "Skills differs" }] };

let dir = "";
let env: NodeJS.ProcessEnv = {};
let clock = START;
const now = () => clock;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gardener-pass-"));
  env = { BRANCH_STATE_DIR: dir };
  clock = START;
  resetGardenerStateForTests();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function passParams(
  cfg: BranchConfig | undefined,
  inputs: GardenerInputs,
  writes: GardenerIssueDraft[],
) {
  return {
    cfg,
    inputs,
    env,
    now,
    writeIssue: async (draft: GardenerIssueDraft) => {
      writes.push(draft);
      return writes.length;
    },
  };
}

describe("default config (agents.gardener unset)", () => {
  it("returns the drafts it would make and writes nothing", async () => {
    const writes: GardenerIssueDraft[] = [];
    const result = await runGardenerPass({
      ...passParams(undefined, { ...failingMain, ...parityGap }, writes),
    });
    expect(result.status).toBe("ran");
    expect(result.dryRun).toBe(true);
    expect(result.jobs.map((job) => job.fingerprint)).toEqual(["ci-main:7", "parity:skills-ui"]);
    expect(result.issues).toEqual([]);
    expect(writes).toEqual([]);
    expect(listQueueItems(env)).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("with enabled false and a repo, plans issue drafts but still writes nothing", async () => {
    const writes: GardenerIssueDraft[] = [];
    const result = await runGardenerPass(
      passParams(disabledWithRepoCfg, { ...failingMain, ...parityGap }, writes),
    );
    expect(result.dryRun).toBe(true);
    expect(result.issues.map((issue) => issue.fingerprint)).toEqual([
      "ci-main:7",
      "parity:skills-ui",
    ]);
    expect(writes).toEqual([]);
    expect(listQueueItems(env)).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe("enabled with a repo", () => {
  it("creates one issue draft and one queued job per fingerprint", async () => {
    const writes: GardenerIssueDraft[] = [];
    const result = await runGardenerPass(
      passParams(enabledCfg, { ...failingMain, ...parityGap }, writes),
    );
    expect(result.dryRun).toBe(false);
    expect(writes.map((draft) => draft.fingerprint)).toEqual(["ci-main:7", "parity:skills-ui"]);
    expect(writes.every((draft) => draft.repo === REPO)).toBe(true);
    const queued = listQueueItems(env);
    expect(queued).toHaveLength(2);
    expect(queued.every((item) => item.title.startsWith("[gardener:"))).toBe(true);
  });

  it("puts the fingerprint in the issue body", async () => {
    const writes: GardenerIssueDraft[] = [];
    await runGardenerPass(passParams(enabledCfg, failingMain, writes));
    expect(writes[0]?.body).toContain("ci-main:7");
    expect(writes[0]?.body).toContain(`/${REPO}/actions/runs/1`);
  });

  it("collapses duplicate signals inside one run to one job", async () => {
    const writes: GardenerIssueDraft[] = [];
    const inputs: GardenerInputs = {
      parityGaps: [
        { key: "x", summary: "first" },
        { key: "x", summary: "second" },
      ],
    };
    const result = await runGardenerPass(passParams(enabledCfg, inputs, writes));
    expect(result.jobs).toHaveLength(1);
    expect(writes).toHaveLength(1);
  });
});

describe("cooldown and rate limit", () => {
  it("a repeated run inside the cooldown produces nothing new", async () => {
    const writes: GardenerIssueDraft[] = [];
    await runGardenerPass(passParams(enabledCfg, failingMain, writes));
    clock += 31 * MINUTE;
    const second = await runGardenerPass(passParams(enabledCfg, failingMain, writes));
    expect(second.status).toBe("ran");
    expect(second.jobs).toEqual([]);
    expect(second.issues).toEqual([]);
    expect(second.suppressed).toEqual([{ fingerprint: "ci-main:7", reason: "cooldown" }]);
    expect(writes).toHaveLength(1);
    expect(listQueueItems(env)).toHaveLength(1);
  });

  it("a fingerprint is planned again after the six-hour cooldown, without a second issue", async () => {
    const writes: GardenerIssueDraft[] = [];
    await runGardenerPass(passParams(enabledCfg, failingMain, writes));
    clock += 6 * 60 * MINUTE + 31 * MINUTE;
    const later = await runGardenerPass(passParams(enabledCfg, failingMain, writes));
    expect(later.jobs.map((job) => job.fingerprint)).toEqual(["ci-main:7"]);
    // The issue for this source already exists, so the job returns without a second issue.
    expect(writes).toHaveLength(1);
  });

  it("a second run inside the rate-limit interval is blocked", async () => {
    const writes: GardenerIssueDraft[] = [];
    await runGardenerPass(passParams(enabledCfg, failingMain, writes));
    clock += 5 * MINUTE;
    const blocked = await runGardenerPass(passParams(enabledCfg, parityGap, writes));
    expect(blocked.status).toBe("rate-limited");
    expect(blocked.jobs).toEqual([]);
    expect(writes).toHaveLength(1);
    expect(listQueueItems(env)).toHaveLength(1);
  });

  it("a restart does not repeat a job that is still inside the cooldown", async () => {
    const writes: GardenerIssueDraft[] = [];
    await runGardenerPass(passParams(enabledCfg, failingMain, writes));
    resetGardenerStateForTests();
    clock += 31 * MINUTE;
    const afterRestart = await runGardenerPass(passParams(enabledCfg, failingMain, writes));
    expect(afterRestart.suppressed).toEqual([{ fingerprint: "ci-main:7", reason: "recent-job" }]);
    expect(writes).toHaveLength(1);
    expect(listQueueItems(env)).toHaveLength(1);
  });
});

describe("config errors", () => {
  it("enabled without a repo is a config error and writes nothing", async () => {
    const writes: GardenerIssueDraft[] = [];
    const result = await runGardenerPass(passParams(enabledNoRepoCfg, failingMain, writes));
    expect(result.status).toBe("config-error");
    expect(result.error).toMatch(/repo/);
    expect(writes).toEqual([]);
    expect(listQueueItems(env)).toEqual([]);
  });

  it("resolveGardenerConfig reads a valid opt-in and reports bad values", () => {
    expect(resolveGardenerConfig(undefined)).toEqual({ ok: true, enabled: false });
    expect(resolveGardenerConfig(enabledCfg)).toEqual({ ok: true, enabled: true, repo: REPO });
    expect(resolveGardenerConfig(enabledNoRepoCfg).ok).toBe(false);
    const badRepo = { agents: { gardener: { enabled: true, repo: "not a repo" } } } as BranchConfig;
    expect(resolveGardenerConfig(badRepo).ok).toBe(false);
  });

  it("the agents schema refuses enabled without a repo and accepts the default", () => {
    const entries = { "builder-1": {} };
    expect(AgentsSchema.safeParse({ entries, gardener: { enabled: true } }).success).toBe(false);
    expect(AgentsSchema.safeParse({ entries, gardener: { enabled: false } }).success).toBe(true);
    expect(
      AgentsSchema.safeParse({ entries, gardener: { enabled: true, repo: REPO } }).success,
    ).toBe(true);
  });
});

describe("queue write failures", () => {
  it("reports the failed write, goes on, and retries that item once the interval has passed", async () => {
    const writes: GardenerIssueDraft[] = [];
    const errors: string[] = [];
    let failParity = true;
    const enqueue = (item: { title: string; brief_text: string; priority: number }) => {
      if (failParity && item.title.includes("parity:skills-ui")) {
        throw new Error("queue unavailable");
      }
      addQueueItem(item, env, clock);
    };
    const withSink = (inputs: GardenerInputs) => ({
      ...passParams(enabledCfg, inputs, writes),
      enqueue,
      onError: (message: string) => errors.push(message),
    });

    const first = await runGardenerPass(withSink({ ...failingMain, ...parityGap }));
    expect(first.status).toBe("ran");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("parity:skills-ui");
    expect(listQueueItems(env).map((item) => item.title)).toEqual([
      '[gardener:ci-main:7] Fix failing main workflow "Engine tests"',
    ]);

    clock += 5 * MINUTE;
    const blocked = await runGardenerPass(withSink(parityGap));
    expect(blocked.status).toBe("rate-limited");
    expect(listQueueItems(env)).toHaveLength(1);

    failParity = false;
    clock += 31 * MINUTE;
    const retry = await runGardenerPass(withSink(parityGap));
    expect(retry.status).toBe("ran");
    expect(retry.jobs.map((job) => job.fingerprint)).toEqual(["parity:skills-ui"]);
    expect(listQueueItems(env)).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });
});

describe("issue idempotency and failure reporting", () => {
  it("a job-write failure then a retry leaves exactly one issue for the source", async () => {
    const issued = new Set<string>();
    const issueWrites: string[] = [];
    const errors: string[] = [];
    let failJob = true;
    const enqueue = (item: { title: string; brief_text: string; priority: number }) => {
      if (failJob && item.title.includes("parity:skills-ui")) {
        throw new Error("queue unavailable");
      }
      addQueueItem(item, env, clock);
    };
    const base = {
      cfg: enabledCfg,
      env,
      now,
      writeIssue: async (draft: GardenerIssueDraft) => {
        issueWrites.push(draft.fingerprint);
        issued.add(draft.fingerprint);
        return 100 + issueWrites.length;
      },
      findIssue: async (fingerprint: string) => issued.has(fingerprint),
      enqueue,
      onError: (message: string) => errors.push(message),
    };
    await runGardenerPass({ ...base, inputs: parityGap });
    expect(errors).toHaveLength(1);

    failJob = false;
    clock += 31 * MINUTE;
    await runGardenerPass({ ...base, inputs: parityGap });
    expect(issueWrites.filter((fingerprint) => fingerprint === "parity:skills-ui")).toHaveLength(1);
    expect(listQueueItems(env)).toHaveLength(1);
  });

  it("a failed write with no handler still logs a warning", async () => {
    const warn = vi.fn();
    await runGardenerPass({
      cfg: enabledCfg,
      inputs: parityGap,
      env,
      now,
      writeIssue: async () => 1,
      enqueue: () => {
        throw new Error("queue unavailable");
      },
      logger: { warn },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("gardener write failed for parity:skills-ui");
  });
});

describe("local issue record", () => {
  it("a local record stops a second issue even when search lags and finds nothing", async () => {
    const issueWrites: string[] = [];
    const errors: string[] = [];
    let failJob = true;
    const enqueue = (item: { title: string; brief_text: string; priority: number }) => {
      if (failJob && item.title.includes("parity:skills-ui")) {
        throw new Error("queue unavailable");
      }
      addQueueItem(item, env, clock);
    };
    const base = {
      cfg: enabledCfg,
      env,
      now,
      writeIssue: async (draft: GardenerIssueDraft) => {
        issueWrites.push(draft.fingerprint);
        return 101;
      },
      findIssue: async () => false,
      enqueue,
      onError: (message: string) => errors.push(message),
    };
    await runGardenerPass({ ...base, inputs: parityGap });
    expect(errors).toHaveLength(1);

    failJob = false;
    clock += 31 * MINUTE;
    await runGardenerPass({ ...base, inputs: parityGap });
    expect(issueWrites.filter((fingerprint) => fingerprint === "parity:skills-ui")).toHaveLength(1);
    expect(listQueueItems(env)).toHaveLength(1);
  });

  it("the search fallback is used when there is no local record", async () => {
    const issueWrites: string[] = [];
    await runGardenerPass({
      cfg: enabledCfg,
      env,
      now,
      inputs: parityGap,
      writeIssue: async (draft: GardenerIssueDraft) => {
        issueWrites.push(draft.fingerprint);
        return 1;
      },
      findIssue: async () => true,
    });
    expect(issueWrites).toHaveLength(0);
  });
});

describe("issue number contract", () => {
  it("a write that returns no issue number is a failed write, reported and retried", async () => {
    const errors: string[] = [];
    await runGardenerPass({
      cfg: enabledCfg,
      env,
      now,
      inputs: parityGap,
      writeIssue: async () => undefined as unknown as number,
      onError: (message: string) => errors.push(message),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("parity:skills-ui");
    expect(listQueueItems(env)).toHaveLength(0);
  });
});
