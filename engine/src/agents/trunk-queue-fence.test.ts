import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addQueueItem,
  claimNextQueueItem,
  closeQueueClaimForThread,
  listQueueItems,
  ORPHAN_CLAIM_GRACE_MS,
  pickUpQueuedWork,
  queueRunId,
  reconcileTrunkQueue,
  releaseOrphanQueueClaims,
  releaseStaleQueueClaims,
  type TrunkQueueGateway,
} from "./trunk-queue.js";

type Call = { method: string; params: Record<string, unknown> };

/** The four-hour cap, spelled out so the test checks the behavior rather than a constant that may not exist. */
const FOUR_HOURS_MS = 4 * 60 * 60_000;

/**
 * A gateway whose claim thread never shows as live (the case that let a reaper free a job while its run was still
 * going). Every run reports `runStatus` to agent.wait until an abort changes it. `abortWorks: false` leaves the run
 * untouched by sessions.abort. Runs in `missingRunIds` are gone: agent.wait throws "agent run was not found".
 */
function fenceGateway(
  runStatus: string,
  options: { abortWorks?: boolean; missingRunIds?: Set<string> } = {},
) {
  const calls: Call[] = [];
  const state = { runStatus };
  const gateway: TrunkQueueGateway = {
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "sessions.list") {
        return { sessions: [] } as T;
      }
      if (method === "sessions.abort") {
        if (options.abortWorks !== false) {
          state.runStatus = "aborted";
        }
        return { ok: true, abortedRunId: params.runId, status: "aborted" } as T;
      }
      if (method === "agent.wait") {
        if (options.missingRunIds?.has(String(params.runId))) {
          throw new Error("agent run was not found");
        }
        return { runId: params.runId, status: state.runStatus } as T;
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

  it("keeps a current-epoch claim with a pending run until the 4-hour cap", async () => {
    addQueueItem({ title: "patient job", brief_text: "patient brief" }, env, 1);
    claimNextQueueItem("builder-birch", env, 1_000);
    const { gateway } = fenceGateway("pending");

    await releaseStaleQueueClaims({
      gateway,
      env,
      now: () => 1_000 + FOUR_HOURS_MS - 1,
    });

    expect(listQueueItems(env)[0]).toMatchObject({
      status: "claimed",
      claimed_by: "builder-birch",
    });
  });

  it("stops a silent claim at the cap, confirms the stop, and says so in plain English", async () => {
    addQueueItem({ title: "silent job", brief_text: "silent brief" }, env, 1);
    claimNextQueueItem("builder-birch", env, 1_000);
    const { gateway, calls } = fenceGateway("pending");
    const logs: string[] = [];

    await releaseStaleQueueClaims({
      gateway,
      env,
      now: () => 1_000 + FOUR_HOURS_MS,
      log: (message) => logs.push(message),
    });

    // The abort goes first, and the claim is freed only after the run reports its end.
    const order = calls.map((call) => call.method);
    expect(order.indexOf("sessions.abort")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("sessions.abort")).toBeLessThan(order.lastIndexOf("agent.wait"));
    expect(listQueueItems(env)[0]).toMatchObject({
      status: "released",
      released_from: "builder-birch",
      fence: 1,
    });
    expect(logs).toEqual([
      "Stopped silent job on builder-birch after 4 hours without finishing; it is back in the queue.",
    ]);
  });

  it("keeps a silent claim held, and asks for attention, when the stop cannot be confirmed", async () => {
    addQueueItem({ title: "stuck job", brief_text: "stuck brief" }, env, 1);
    claimNextQueueItem("builder-birch", env, 1_000);
    const { gateway } = fenceGateway("pending", { abortWorks: false });
    const logs: string[] = [];

    await releaseStaleQueueClaims({
      gateway,
      env,
      now: () => 1_000 + FOUR_HOURS_MS,
      log: (message) => logs.push(message),
    });

    expect(listQueueItems(env)[0]).toMatchObject({
      status: "claimed",
      claimed_by: "builder-birch",
    });
    expect(logs).toEqual([
      "Could not stop stuck job on builder-birch after 4 hours without finishing; it stays claimed. Needs attention.",
    ]);
  });

  it("fences out a late result from a stopped run after the job went to another builder", async () => {
    const job = addQueueItem({ title: "late job", brief_text: "late brief" }, env, 1);
    const claim = claimNextQueueItem("builder-birch", env, 1_000);
    const oldThread = claim!.thread_key;
    const { gateway } = fenceGateway("pending");

    await releaseStaleQueueClaims({ gateway, env, now: () => 1_000 + FOUR_HOURS_MS });
    await pickUpQueuedWork({
      agentId: "builder-oak",
      gateway,
      env,
      now: () => 2_000 + FOUR_HOURS_MS,
    });
    const reclaimed = listQueueItems(env).find((row) => row.id === job.id);
    expect(reclaimed).toMatchObject({ claimed_by: "builder-oak" });

    // The stopped run reports completion late, on its old thread.
    expect(closeQueueClaimForThread(oldThread, "completed", env)).toBe(false);

    expect(listQueueItems(env).find((row) => row.id === job.id)).toMatchObject({
      status: "claimed",
      claimed_by: "builder-oak",
    });
    expect(listQueueItems(env).find((row) => row.id === job.id)?.done_at).toBeUndefined();
  });

  it("releases only the job whose run is gone, and the sweep keeps going for the others", async () => {
    const lost = addQueueItem({ title: "lost run job", brief_text: "lost" }, env, 1);
    const live = addQueueItem({ title: "live run job", brief_text: "live" }, env, 2);
    addQueueItem({ title: "queued job", brief_text: "queued" }, env, 3);
    const lostClaim = claimNextQueueItem("builder-birch", env, 1_000);
    claimNextQueueItem("builder-oak", env, 1_000);
    const lostRunId = queueRunId(lost.id, lostClaim!.claim_id);
    const { gateway, calls } = fenceGateway("pending", { missingRunIds: new Set([lostRunId]) });

    await expect(
      reconcileTrunkQueue({
        gateway,
        agentIds: async () => ["builder-ash"],
        env,
        now: () => 1_000 + ORPHAN_CLAIM_GRACE_MS + 1,
      }),
    ).resolves.toBeUndefined();

    const rows = listQueueItems(env);
    expect(rows.find((row) => row.id === lost.id)).not.toMatchObject({
      claimed_by: "builder-birch",
    });
    expect(rows.find((row) => row.id === live.id)).toMatchObject({
      status: "claimed",
      claimed_by: "builder-oak",
    });
    // The freed job was picked up by the idle builder in the same pass.
    expect(briefsSent(calls).map((call) => call.params.agentId)).toEqual(["builder-ash"]);
  });
});
