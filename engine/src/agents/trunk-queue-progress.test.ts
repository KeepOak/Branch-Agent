import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addQueueItem,
  claimNextQueueItem,
  markQueueItemDone,
  setQueueTransitionListener,
  type QueueTransition,
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
