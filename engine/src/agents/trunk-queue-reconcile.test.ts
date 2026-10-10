import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startTrunkQueueSweep,
  TRUNK_QUEUE_SWEEP_MS,
  onTrunkRunLifecycle,
} from "../gateway/server-methods/trunk-queue.js";
import { isDefinitiveRunLifecycle } from "./agent-run-terminal-outcome.js";
import { isTrunkStartupPending } from "./trunk-queue-policy.js";
import {
  addQueueItem,
  claimNextQueueItem,
  closeQueueClaimForThread,
  listQueueItems,
  MAX_CLAIM_FAILURES,
  ORPHAN_CLAIM_GRACE_MS,
  pickUpQueuedWork,
  reconcileTrunkQueue,
  releaseOrphanQueueClaims,
  releaseQueueItem,
  type TrunkQueueGateway,
} from "./trunk-queue.js";

type Call = { method: string; params: Record<string, unknown> };

/**
 * A gateway whose live sessions are `liveKeys`. sessions.list answers like the real one for an activeOnly query:
 * only live rows of that Trunk, cut to the requested limit.
 */
function fakeGateway(liveKeys: string[] = []) {
  const calls: Call[] = [];
  const gateway: TrunkQueueGateway = {
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "sessions.list") {
        const agent = String(params.agentId);
        const rows = liveKeys
          .filter((key) => key.startsWith(`agent:${agent}:`))
          .map((key) => ({ key, hasActiveRun: true }));
        return { sessions: rows.slice(0, Number(params.limit ?? 50)) } as T;
      }
      if (method === "agents.list") {
        return { agents: [{ id: "builder-ash" }] } as T;
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

/**
 * Two idle builders. chat.history answers each thread with its stored replies (none by default), the way a run
 * whose output was lost leaves its thread.
 */
function twoBuilderGateway(replies: Record<string, string[]> = {}) {
  const calls: Call[] = [];
  const gateway: TrunkQueueGateway = {
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "sessions.list") {
        return { sessions: [] } as T;
      }
      if (method === "agents.list") {
        return { agents: [{ id: "builder-ash" }, { id: "builder-birch" }] } as T;
      }
      if (method === "chat.history") {
        const messages = (replies[String(params.sessionKey)] ?? []).map((text) => ({
          role: "assistant",
          content: [{ type: "text", text }],
        }));
        return { messages } as T;
      }
      return {} as T;
    },
  };
  return { gateway, calls };
}

describe("Trunk queue claim closes by how its run ended", () => {
  it("marks the job done when the run's final message links a PR", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const claim = claimNextQueueItem("builder-ash");
    const { gateway, calls } = twoBuilderGateway({
      [claim!.thread_key]: [
        "Working on it.",
        "Final message: PR https://github.com/KeepOak/Branch-Agent/pull/999 | head 0123abcd",
      ],
    });

    await onTrunkRunLifecycle({
      agentId: "builder-ash",
      terminal: true,
      threadKey: claim!.thread_key,
      outcome: "completed",
      gateway,
    });

    expect(rowById(job.id)?.status).toBe("done");
    expect(briefedThreads(calls)).toEqual([]);
  });

  it("releases a failed run's job and hands it to an idle builder at once", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const claim = claimNextQueueItem("builder-ash");
    const { gateway, calls } = twoBuilderGateway();

    await onTrunkRunLifecycle({
      agentId: "builder-ash",
      terminal: true,
      threadKey: claim!.thread_key,
      outcome: "failed",
      gateway,
    });

    const row = rowById(job.id);
    expect(row?.failures).toBe(1);
    expect(row?.status).toBe("claimed");
    expect(row?.claimed_by).toBe("builder-birch");
    expect(briefedThreads(calls)).toEqual([row?.thread_key]);
  });

  it("releases a run that ended empty instead of marking it done, and an idle builder takes it", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const claim = claimNextQueueItem("builder-ash");
    const { gateway, calls } = twoBuilderGateway();

    await onTrunkRunLifecycle({
      agentId: "builder-ash",
      terminal: true,
      threadKey: claim!.thread_key,
      outcome: "completed",
      gateway,
    });

    const row = rowById(job.id);
    expect(row?.done_at).toBeUndefined();
    expect(row?.failures).toBe(1);
    expect(row?.claimed_by).toBe("builder-birch");
    expect(briefedThreads(calls)).toEqual([row?.thread_key]);
  });

  it("releases a run whose final message has no PR link", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const claim = claimNextQueueItem("builder-ash");
    const { gateway } = twoBuilderGateway();

    await onTrunkRunLifecycle({
      agentId: "builder-ash",
      terminal: true,
      threadKey: claim!.thread_key,
      outcome: "completed",
      data: { terminalReply: { disposition: "visible", text: "I looked into it." } },
      gateway,
    });

    expect(rowById(job.id)?.done_at).toBeUndefined();
    expect(rowById(job.id)?.claimed_by).toBe("builder-birch");
  });

  it("keeps the claim open when the run yielded to wait for its sub-agents", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const claim = claimNextQueueItem("builder-ash");
    const { gateway, calls } = twoBuilderGateway();

    await onTrunkRunLifecycle({
      agentId: "builder-ash",
      terminal: true,
      threadKey: claim!.thread_key,
      outcome: "completed",
      data: { yielded: true },
      gateway,
    });

    expect(rowById(job.id)?.claimed_by).toBe("builder-ash");
    expect(rowById(job.id)?.thread_key).toBe(claim!.thread_key);
    expect(briefedThreads(calls)).toEqual([]);
  });
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
      data: { terminalReply: { disposition: "visible", text: "Final message: PR #12 | head abc" } },
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

  it("puts a job back after failed runs and blocks it at the cap with a plain reason", async () => {
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

    const row = rowById(job.id);
    expect(threadKey).toBeUndefined();
    expect(row?.failures).toBe(MAX_CLAIM_FAILURES);
    expect(row?.status).toBe("blocked");
    expect(row?.blocked_reason).toContain(`${MAX_CLAIM_FAILURES} failed attempts`);
    expect(claimNextQueueItem("builder-ash")).toBeUndefined();
  });

  it("makes a blocked job claimable again when it is released", () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    for (let attempt = 0; attempt < MAX_CLAIM_FAILURES; attempt += 1) {
      const claim = claimNextQueueItem("builder-ash");
      closeQueueClaimForThread(claim!.thread_key, "failed");
    }
    expect(rowById(job.id)?.status).toBe("blocked");

    releaseQueueItem(job.id);

    expect(rowById(job.id)?.status).toBe("released");
    expect(claimNextQueueItem("builder-ash")?.id).toBe(job.id);
  });

  it("treats a clean end as definitive, so a finished job is not dispatched again", () => {
    expect(isDefinitiveRunLifecycle({ phase: "end" })).toBe(true);
    expect(isDefinitiveRunLifecycle({ phase: "start" })).toBe(false);
  });
});

describe("Trunk queue reconcile", () => {
  it("hands a queued job to an idle builder with no run-end event", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const { gateway, calls } = fakeGateway();

    await reconcileTrunkQueue({ gateway, agentIds: async () => ["builder-ash"] });

    expect(rowById(job.id)?.status).toBe("claimed");
    expect(briefedThreads(calls)).toEqual([rowById(job.id)?.thread_key]);
  });

  it("after a restart, releases an orphaned claim and dispatches the job again as a fresh claim", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
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
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
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

  it("finds its own live thread even when sixty other live sessions come before it", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const claim = claimNextQueueItem(
      "builder-ash",
      undefined,
      Date.now() - ORPHAN_CLAIM_GRACE_MS - 1_000,
    );
    const others = Array.from({ length: 60 }, (_, index) => `agent:builder-ash:other-${index}`);
    const { gateway } = fakeGateway([...others, claim!.thread_key]);

    await releaseOrphanQueueClaims({ gateway });

    expect(rowById(job.id)?.claim_id).toBe(claim?.claim_id);
  });

  it("never releases a claim whose brief is still being sent, however old it looks", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    let finishSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      finishSend = resolve;
    });
    const { gateway, calls } = fakeGateway();
    const slowSend: TrunkQueueGateway = {
      async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
        if (method === "chat.send") {
          await sendGate;
        }
        return gateway.request<T>(method, params);
      },
    };

    const pending = pickUpQueuedWork({ agentId: "builder-ash", gateway: slowSend });
    await vi.waitFor(() =>
      expect(calls.some((call) => call.method === "sessions.create")).toBe(true),
    );
    const claimId = rowById(job.id)?.claim_id;

    await releaseOrphanQueueClaims({
      gateway,
      now: () => Date.now() + ORPHAN_CLAIM_GRACE_MS + 60_000,
    });

    expect(rowById(job.id)?.claim_id).toBe(claimId);
    finishSend();
    await pending;
    expect(rowById(job.id)?.status).toBe("claimed");
  });
});

describe("Trunk queue sweep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs one sweep per process, stops on abort, and starts again only after a new start", async () => {
    vi.useFakeTimers();
    addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const { gateway, calls } = fakeGateway();
    const agentListCalls = () => calls.filter((call) => call.method === "agents.list").length;
    const config = { getConfig: () => undefined, log: () => {}, gateway };
    const first = new AbortController();

    expect(startTrunkQueueSweep({ ...config, signal: first.signal })).toBe(true);
    expect(startTrunkQueueSweep({ ...config, signal: first.signal })).toBe(false);

    await vi.advanceTimersByTimeAsync(TRUNK_QUEUE_SWEEP_MS);
    expect(agentListCalls()).toBe(1);

    first.abort();
    await vi.advanceTimersByTimeAsync(TRUNK_QUEUE_SWEEP_MS * 3);
    expect(agentListCalls()).toBe(1);

    addQueueItem({ title: "second job", brief_text: "b2", priority: 1 });
    const second = new AbortController();
    expect(startTrunkQueueSweep({ ...config, signal: second.signal })).toBe(true);
    await vi.advanceTimersByTimeAsync(TRUNK_QUEUE_SWEEP_MS);
    expect(agentListCalls()).toBe(2);
    second.abort();
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
