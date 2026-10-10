import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onTrunkRunLifecycle } from "../gateway/server-methods/trunk-queue.js";
import { isTrunkStartupPending } from "./trunk-queue-policy.js";
import {
  addQueueItem,
  claimNextQueueItem,
  listQueueItems,
  MAX_CLAIM_FAILURES,
  ORPHAN_CLAIM_GRACE_MS,
  reconcileTrunkQueue,
  type TrunkQueueGateway,
} from "./trunk-queue.js";

type Call = { method: string; params: Record<string, unknown> };

/** A gateway where the Trunks in `working` have a live run; every other call succeeds with nothing to report. */
function fakeGateway(working: Set<string> = new Set()) {
  const calls: Call[] = [];
  const gateway: TrunkQueueGateway = {
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "sessions.list") {
        const live = working.has(String(params.agentId));
        return { sessions: live ? [{ key: "live", hasActiveRun: true }] : [] } as T;
      }
      return {} as T;
    },
  };
  return { gateway, calls };
}

/** Thread keys the gateway was asked to send a brief to. */
function briefedThreads(calls: Call[]): string[] {
  return calls
    .filter((call) => call.method === "chat.send")
    .map((call) => String(call.params.sessionKey));
}

function rowById(id: string) {
  return listQueueItems().find((row) => row.id === id);
}

let dir = "";
const savedStateDir = process.env.BRANCH_STATE_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-trunk-reconcile-"));
  process.env.BRANCH_STATE_DIR = dir;
});

afterEach(() => {
  if (savedStateDir === undefined) {
    delete process.env.BRANCH_STATE_DIR;
  } else {
    process.env.BRANCH_STATE_DIR = savedStateDir;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Trunk queue claim closes at its own run end", () => {
  it("completes the claim when its own thread's run ends cleanly, then gives the builder the next job", async () => {
    const first = addQueueItem({ title: "first", brief_text: "one", priority: 2 });
    const second = addQueueItem({ title: "second", brief_text: "two", priority: 1 });
    const claim = claimNextQueueItem("builder-ash");
    const { gateway, calls } = fakeGateway();

    await onTrunkRunLifecycle({
      agentId: "builder-ash",
      terminal: true,
      threadKey: claim?.thread_key,
      outcome: "completed",
      gateway,
    });

    expect(rowById(first.id)?.status).toBe("done");
    expect(rowById(second.id)?.status).toBe("claimed");
    expect(briefedThreads(calls)).toEqual([rowById(second.id)?.thread_key]);
  });

  it("leaves the claim open when a run in another thread of the same builder ends", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    claimNextQueueItem("builder-ash");
    const { gateway, calls } = fakeGateway();

    await onTrunkRunLifecycle({
      agentId: "builder-ash",
      terminal: true,
      threadKey: "agent:builder-ash:main",
      outcome: "completed",
      gateway,
    });

    expect(rowById(job.id)?.status).toBe("claimed");
    expect(briefedThreads(calls)).toEqual([]);
  });

  it("puts a job back after failed runs and stops handing it out after the cap", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const { gateway } = fakeGateway();
    let threadKey = claimNextQueueItem("builder-ash")?.thread_key;

    for (let attempt = 1; attempt <= MAX_CLAIM_FAILURES; attempt += 1) {
      expect(threadKey).toBeDefined();
      await onTrunkRunLifecycle({
        agentId: "builder-ash",
        terminal: true,
        threadKey,
        outcome: "failed",
        gateway,
      });
      threadKey = rowById(job.id)?.thread_key;
    }

    expect(threadKey).toBeUndefined();
    expect(rowById(job.id)?.failures).toBe(MAX_CLAIM_FAILURES);
    expect(claimNextQueueItem("builder-ash")).toBeUndefined();
  });
});

describe("Trunk queue reconcile", () => {
  it("hands a queued job to an idle builder with no run-end event", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 }, undefined, 1);
    const { gateway, calls } = fakeGateway();

    await reconcileTrunkQueue({ gateway, agentIds: async () => ["builder-ash"] });

    expect(rowById(job.id)?.status).toBe("claimed");
    expect(briefedThreads(calls)).toEqual([rowById(job.id)?.thread_key]);
  });

  it("after a restart, releases an orphaned claim and dispatches the job again as a fresh claim", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 }, undefined, 1);
    const orphan = claimNextQueueItem("builder-ash", undefined, 100);
    const { gateway, calls } = fakeGateway();

    await reconcileTrunkQueue({
      gateway,
      agentIds: async () => ["builder-ash"],
      now: () => 100 + ORPHAN_CLAIM_GRACE_MS + 1,
    });

    const row = rowById(job.id);
    expect(row?.status).toBe("claimed");
    expect(row?.claim_id).not.toBe(orphan?.claim_id);
    expect(row?.failures ?? 0).toBe(0);
    expect(briefedThreads(calls)).toEqual([row?.thread_key]);
  });

  it("leaves a fresh claim alone during the grace period", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 }, undefined, 1);
    const claim = claimNextQueueItem("builder-ash", undefined, 100);
    const { gateway, calls } = fakeGateway();

    await reconcileTrunkQueue({
      gateway,
      agentIds: async () => ["builder-ash"],
      now: () => 100 + 1_000,
    });

    expect(rowById(job.id)?.claim_id).toBe(claim?.claim_id);
    expect(calls.some((call) => call.method === "sessions.list")).toBe(false);
  });

  it("makes no gateway call when the queue is empty", async () => {
    const { gateway, calls } = fakeGateway();

    await reconcileTrunkQueue({ gateway, agentIds: async () => ["builder-ash"] });

    expect(calls).toEqual([]);
  });
});

describe("Trunk startup pending", () => {
  it("treats a Trunk still retrying its startup as pending, and a healthy one as ready", () => {
    expect(
      isTrunkStartupPending({
        id: "builder-ash",
        admissionRefusal: { preparation: { state: "retrying" } },
      }),
    ).toBe(true);
    expect(isTrunkStartupPending({ id: "builder-ash" })).toBe(false);
  });
});
