import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addQueueItem,
  claimNextQueueItem,
  listQueueItems,
  ORPHAN_CLAIM_GRACE_MS,
  pickUpQueuedWork,
  reconcileTrunkQueue,
  releaseOrphanQueueClaims,
  type TrunkQueueGateway,
} from "./trunk-queue.js";

type Call = { method: string; params: Record<string, unknown> };

/**
 * A gateway whose claim thread never shows as live (the case that let a reaper free a job while its run was still
 * going), and whose run reports `runStatus` to agent.wait.
 */
function fenceGateway(runStatus: string) {
  const calls: Call[] = [];
  const gateway: TrunkQueueGateway = {
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "sessions.list") {
        return { sessions: [] } as T;
      }
      if (method === "agent.wait") {
        return { runId: params.runId, status: runStatus } as T;
      }
      return {} as T;
    },
  };
  return { gateway, calls };
}

const briefsSent = (calls: Call[]) => calls.filter((call) => call.method === "chat.send");

let dir = "";
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-trunk-fence-"));
  env = { BRANCH_STATE_DIR: dir };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Trunk queue fenced claims", () => {
  it("does not hand a job out again while its first run is still live", async () => {
    addQueueItem({ title: "merge job", brief_text: "merge brief" }, env, 1);
    const { gateway, calls } = fenceGateway("pending");
    const first = await pickUpQueuedWork({
      agentId: "builder-birch",
      gateway,
      env,
      now: () => 1_000,
    });
    expect(first).toBeDefined();

    // Past the orphan grace period with no run activity recorded, and two other builders are idle.
    await reconcileTrunkQueue({
      gateway,
      agentIds: async () => ["builder-birch", "builder-oak"],
      env,
      now: () => 1_000 + ORPHAN_CLAIM_GRACE_MS + 1,
    });

    expect(briefsSent(calls)).toHaveLength(1);
    expect(listQueueItems(env)[0]).toMatchObject({
      status: "claimed",
      claimed_by: "builder-birch",
    });
  });

  it("hands the job out again once its first run has ended", async () => {
    addQueueItem({ title: "merge job", brief_text: "merge brief" }, env, 1);
    const { gateway, calls } = fenceGateway("ok");
    await pickUpQueuedWork({ agentId: "builder-birch", gateway, env, now: () => 1_000 });

    await reconcileTrunkQueue({
      gateway,
      agentIds: async () => ["builder-oak", "builder-birch"],
      env,
      now: () => 1_000 + ORPHAN_CLAIM_GRACE_MS + 1,
    });

    expect(briefsSent(calls).map((call) => call.params.agentId)).toEqual([
      "builder-birch",
      "builder-oak",
    ]);
    expect(listQueueItems(env)[0]).toMatchObject({ claimed_by: "builder-oak" });
  });

  it("releases a claim from a previous gateway epoch when its run timed out", async () => {
    addQueueItem({ title: "restart job", brief_text: "restart brief" }, env, 1);
    claimNextQueueItem("builder-birch", env, 1_000, "previous-epoch");
    const { gateway } = fenceGateway("timeout");

    await releaseOrphanQueueClaims({
      gateway,
      env,
      now: () => 1_000 + ORPHAN_CLAIM_GRACE_MS + 1,
    });

    expect(listQueueItems(env)[0]).toMatchObject({
      status: "released",
      released_from: "builder-birch",
    });
  });

  it("holds a claim from the current gateway epoch while its run is pending", async () => {
    addQueueItem({ title: "live job", brief_text: "live brief" }, env, 1);
    claimNextQueueItem("builder-birch", env, 1_000);
    const { gateway } = fenceGateway("pending");

    await releaseOrphanQueueClaims({
      gateway,
      env,
      now: () => 1_000 + ORPHAN_CLAIM_GRACE_MS + 1,
    });

    expect(listQueueItems(env)[0]).toMatchObject({
      status: "claimed",
      claimed_by: "builder-birch",
    });
  });
});
