import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addQueueItem,
  claimNextQueueItem,
  closeQueueClaimForThread,
  markQueueItemDone,
  ORPHAN_CLAIM_GRACE_MS,
  pickUpQueuedWork,
  releaseOrphanQueueClaims,
  releaseQueueItem,
  releaseStaleQueueClaims,
  setQueueTransitionListener,
  STALE_CLAIM_MS,
  type QueueTransition,
  type TrunkQueueGateway,
} from "./trunk-queue.js";

let env: NodeJS.ProcessEnv;
let dir: string;
let seen: QueueTransition[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-queue-progress-"));
  env = { ...process.env, BRANCH_STATE_DIR: dir };
  seen = [];
  setQueueTransitionListener((transition) => seen.push(transition));
});

afterEach(() => {
  setQueueTransitionListener(undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("queue transitions", () => {
  it("reports one claim, and nothing for a second claim while the Trunk holds one", () => {
    addQueueItem({ title: "Job", brief_text: "Do it." }, env, 1_000);
    expect(claimNextQueueItem("builder-scout", env, 1_100)).toBeDefined();
    expect(claimNextQueueItem("builder-scout", env, 1_200)).toBeUndefined();
    expect(seen.map((t) => t.kind)).toEqual(["claimed"]);
    expect(seen[0]?.agentId).toBe("builder-scout");
  });

  it("reports completion once, however many times it is marked done", () => {
    const job = addQueueItem({ title: "Job", brief_text: "Do it." }, env, 1_000);
    markQueueItemDone(job.id, env, 1_100);
    markQueueItemDone(job.id, env, 1_200);
    expect(seen.filter((t) => t.kind === "done")).toHaveLength(1);
  });

  it("produces nothing while the queue is idle", () => {
    expect(claimNextQueueItem("builder-scout", env, 1_000)).toBeUndefined();
    expect(seen).toEqual([]);
  });
});

/** A gateway whose claim runs have all ended and whose threads are not live: a claim is free to be reaped. */
const endedGateway: TrunkQueueGateway = {
  async request<T>(method: string): Promise<T> {
    if (method === "sessions.list") {
      return { sessions: [] } as T;
    }
    if (method === "agent.wait") {
      return { status: "ok" } as T;
    }
    return {} as T;
  },
};

describe("queue transitions: closing and reaping", () => {
  it("announces a run that finishes normally as done, without queue_done", () => {
    addQueueItem({ title: "Job", brief_text: "Do it." }, env, 1_000);
    const claim = claimNextQueueItem("builder-scout", env, 1_100);
    expect(claim?.thread_key).toBeDefined();

    expect(closeQueueClaimForThread(claim!.thread_key!, "completed", env, 1_200)).toBe(true);

    const done = seen.filter((t) => t.kind === "done");
    expect(done).toHaveLength(1);
    expect(done[0]?.item.id).toBe(claim!.id);
    expect(done[0]?.agentId).toBe("builder-scout");
  });

  it("announces a claim the orphan release frees, with the Trunk that lost it", async () => {
    addQueueItem({ title: "Job", brief_text: "Do it." }, env, 1);
    await pickUpQueuedWork({ agentId: "builder-birch", gateway: endedGateway, env, now: () => 1_000 });

    await releaseOrphanQueueClaims({
      gateway: endedGateway,
      env,
      now: () => 1_000 + ORPHAN_CLAIM_GRACE_MS + 1,
    });

    const released = seen.filter((t) => t.kind === "released");
    expect(released).toHaveLength(1);
    expect(released[0]?.agentId).toBe("builder-birch");
  });

  it("announces a stale claim the abandoned-claim reaper frees, with the Trunk that lost it", async () => {
    addQueueItem({ title: "Job", brief_text: "Do it." }, env, 1);
    await pickUpQueuedWork({ agentId: "builder-birch", gateway: endedGateway, env, now: () => 1_000 });

    await releaseStaleQueueClaims({
      gateway: endedGateway,
      env,
      now: () => 1_000 + STALE_CLAIM_MS + 1,
    });

    const released = seen.filter((t) => t.kind === "released");
    expect(released).toHaveLength(1);
    expect(released[0]?.agentId).toBe("builder-birch");
  });

  it("numbers each transition in the order the queue decided it", () => {
    const job = addQueueItem({ title: "Job", brief_text: "Do it." }, env, 1_000);
    const claim = claimNextQueueItem("builder-scout", env, 1_100);
    releaseQueueItem(job.id, env, 1_150, claim!.claim_id);
    markQueueItemDone(job.id, env, 1_200);

    expect(seen.map((t) => t.kind)).toEqual(["claimed", "released", "done"]);
    const seqs = seen.map((t) => t.seq);
    expect(seqs.every((seq) => Number.isInteger(seq))).toBe(true);
    expect(seqs).toEqual(seqs.toSorted((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});
