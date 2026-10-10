// Fenced claims on the Trunk work queue: lease tokens, conditional release and settle, the expired-claim reaper,
// and one operation key across attempts. Board #427: one job ran on two Trunks at once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addQueueItem,
  claimNextQueueItem,
  closeQueueClaimForThread,
  listQueueItems,
  pickUpQueuedWork,
  reapExpiredQueueClaims,
  reconcileTrunkQueue,
  releaseQueueClaim,
  settleQueueClaim,
  type TrunkQueueGateway,
} from "./trunk-queue.js";

type Call = { method: string; params: Record<string, unknown> };

/** A gateway whose live sessions are `liveKeys`, answering an activeOnly sessions.list like the real one. */
function fakeGateway(liveKeys: string[] = []) {
  const calls: Call[] = [];
  const gateway: TrunkQueueGateway = {
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "sessions.list") {
        const agent = String(params.agentId);
        return {
          sessions: liveKeys
            .filter((key) => key.startsWith(`agent:${agent}:`))
            .map((key) => ({ key, hasActiveRun: true })),
        } as T;
      }
      return {} as T;
    },
  };
  return { gateway, calls };
}

const sends = (calls: Call[]) => calls.filter((call) => call.method === "chat.send");

let dir = "";
let env: NodeJS.ProcessEnv = {};

function queueFile(): string {
  return path.join(dir, "trunks", "queue.json");
}

function row(id: string) {
  return listQueueItems(env).find((item) => item.id === id);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-trunk-lease-"));
  env = { ...process.env, BRANCH_STATE_DIR: dir };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Trunk queue leases", () => {
  it("never lets a late failure from an expired holder release the new holder's claim", async () => {
    const settings = { leaseMs: 60_000, maxAttempts: 3 };
    const job = addQueueItem({ title: "job", brief_text: "b" }, env, 0);
    const birch = claimNextQueueItem("builder-birch", env, 0, settings)!;
    const { gateway } = fakeGateway();

    await reapExpiredQueueClaims({ gateway, env, now: () => 60_000, settings });
    const oak = claimNextQueueItem("builder-oak", env, 61_000, settings)!;
    expect(oak.id).toBe(job.id);

    // birch's run fails late, after its lease ran out and oak took the job.
    expect(
      settleQueueClaim(job.id, birch.lease_token, "failed", { env, now: 62_000, settings }),
    ).toBe(0);
    expect(closeQueueClaimForThread(birch.thread_key, "failed", env, 62_000, settings)).toBe(false);
    expect(releaseQueueClaim(job.id, birch.lease_token, env, 62_000)).toBe(0);

    expect(row(job.id)).toMatchObject({
      status: "claimed",
      claimed_by: "builder-oak",
      lease_token: oak.lease_token,
      attempts: 1,
    });
  });

  it("changes a job on release or settle only when exactly one claim carries the lease token", () => {
    const job = addQueueItem({ title: "job", brief_text: "b" }, env, 0);
    const claim = claimNextQueueItem("builder-birch", env, 0)!;
    const before = fs.readFileSync(queueFile(), "utf8");

    expect(releaseQueueClaim(job.id, "another-lease", env, 1)).toBe(0);
    expect(settleQueueClaim(job.id, "another-lease", "completed", { env, now: 1 })).toBe(0);
    expect(fs.readFileSync(queueFile(), "utf8")).toBe(before);

    // Two rows carrying the same lease is an ambiguous match: a lost lease, so nothing changes.
    const rows = JSON.parse(before) as unknown[];
    fs.writeFileSync(queueFile(), JSON.stringify([...rows, rows[0]]));
    const doubled = fs.readFileSync(queueFile(), "utf8");
    expect(releaseQueueClaim(job.id, claim.lease_token, env, 2)).toBe(2);
    expect(settleQueueClaim(job.id, claim.lease_token, "completed", { env, now: 2 })).toBe(2);
    expect(fs.readFileSync(queueFile(), "utf8")).toBe(doubled);

    fs.writeFileSync(queueFile(), before);
    expect(settleQueueClaim(job.id, claim.lease_token, "completed", { env, now: 3 })).toBe(1);
    expect(row(job.id)).toMatchObject({ status: "done", done_at: 3 });
    expect(releaseQueueClaim(job.id, claim.lease_token, env, 4)).toBe(0);
  });

  it("reaps an expired claim back to pending, and sends a claim past the attempt limit to dead", async () => {
    let clock = 0;
    const now = () => clock;
    const settings = { leaseMs: 1_000, maxAttempts: 2 };
    const job = addQueueItem({ title: "job", brief_text: "b" }, env, clock);
    const { gateway, calls } = fakeGateway();

    const first = claimNextQueueItem("builder-birch", env, clock, settings)!;
    clock = 999;
    await reapExpiredQueueClaims({ gateway, env, now, settings });
    expect(row(job.id)).toMatchObject({ status: "claimed", lease_token: first.lease_token });
    expect(calls).toEqual([]);

    clock = 1_000;
    await reapExpiredQueueClaims({ gateway, env, now, settings });
    expect(row(job.id)).toMatchObject({
      status: "released",
      released_from: "builder-birch",
      attempts: 1,
    });

    claimNextQueueItem("builder-oak", env, clock, settings);
    clock = 2_000;
    await reapExpiredQueueClaims({ gateway, env, now, settings });
    expect(row(job.id)).toMatchObject({ status: "dead", attempts: 2 });
    expect(row(job.id)?.dead_reason).toContain("Stopped after 2 attempts");
    expect(claimNextQueueItem("builder-ash", env, clock, settings)).toBeUndefined();
  });

  it("renews an expired lease while its Trunk still has a live run", async () => {
    const settings = { leaseMs: 1_000, maxAttempts: 2 };
    const job = addQueueItem({ title: "job", brief_text: "b" }, env, 0);
    const claim = claimNextQueueItem("builder-birch", env, 0, settings)!;
    const { gateway } = fakeGateway([claim.thread_key]);

    await reapExpiredQueueClaims({ gateway, env, now: () => 5_000, settings });

    expect(row(job.id)).toMatchObject({
      status: "claimed",
      lease_token: claim.lease_token,
      lease_expires_at: 6_000,
    });
    expect(row(job.id)?.attempts).toBeUndefined();
  });

  it("keeps one operation key across attempts and gives each attempt its own id", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b" }, env);
    const { gateway, calls } = fakeGateway();

    const first = await pickUpQueuedWork({ agentId: "builder-birch", gateway, env });
    const firstClaim = row(job.id)!;
    expect(releaseQueueClaim(job.id, firstClaim.lease_token!, env)).toBe(1);
    const second = await pickUpQueuedWork({ agentId: "builder-oak", gateway, env });
    const secondClaim = row(job.id)!;

    expect(first?.item.id).toBe(job.id);
    expect(second?.item.id).toBe(job.id);
    expect(firstClaim.operation_key).toBe(`trunk-queue-${job.id}`);
    expect(secondClaim.operation_key).toBe(firstClaim.operation_key);
    expect(secondClaim.attempt_id).toBeTruthy();
    expect(secondClaim.attempt_id).not.toBe(firstClaim.attempt_id);
    expect(secondClaim.lease_token).not.toBe(firstClaim.lease_token);
    const keys = sends(calls).map((call) => String(call.params.idempotencyKey));
    expect(keys).toEqual([
      `${firstClaim.operation_key}:${firstClaim.attempt_id}`,
      `${firstClaim.operation_key}:${secondClaim.attempt_id}`,
    ]);
  });

  it("hands a job to exactly one Trunk, and never to a second while the first lease holds (#427)", async () => {
    const start = Date.now();
    const job = addQueueItem({ title: "merge PR", brief_text: "merge it" }, env, start);
    // As on #427, the live run does not show in the session list, so liveness cannot be trusted to keep it.
    const { gateway, calls } = fakeGateway();

    const both = await Promise.all([
      pickUpQueuedWork({ agentId: "builder-birch", gateway, env, now: () => start }),
      pickUpQueuedWork({ agentId: "builder-oak", gateway, env, now: () => start }),
    ]);
    expect(both.filter(Boolean)).toHaveLength(1);
    const holder = row(job.id)!;

    // Minutes later, while the holder's run is still going, the periodic pass runs for every builder.
    await reconcileTrunkQueue({
      gateway,
      env,
      agentIds: async () => ["builder-birch", "builder-oak", "builder-cedar"],
      now: () => start + 5 * 60_000,
    });
    // The holder's run ends somewhere else and it asks for work again: it still holds this job.
    await pickUpQueuedWork({
      agentId: holder.claimed_by!,
      gateway,
      env,
      now: () => start + 6 * 60_000,
    });

    expect(row(job.id)).toMatchObject({
      status: "claimed",
      claimed_by: holder.claimed_by,
      lease_token: holder.lease_token,
    });
    expect(sends(calls)).toHaveLength(1);
  });
});
