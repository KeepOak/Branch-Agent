import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addQueueItem,
  claimNextQueueItem,
  listQueueItems,
  ORPHAN_CLAIM_GRACE_MS,
  releaseOrphanQueueClaims,
  releaseStaleQueueClaims,
  STALE_CLAIM_MS,
  trunkAvailabilityLogger,
  UNAVAILABLE_RETRY_MS,
  wakeIdleTrunks,
  type TrunkAvailability,
  type TrunkQueueGateway,
} from "./trunk-queue.js";

type Call = { method: string; params: Record<string, unknown> };

/** A not-ready error the way the gateway client raises it: the UNAVAILABLE code with the startup message. */
function notReady(agentId: string): Error {
  return Object.assign(
    new Error(
      `Agent ${agentId} has not completed startup inspection and preparation. Retry shortly.`,
    ),
    { gatewayCode: "UNAVAILABLE" },
  );
}

/**
 * Gateway where the Trunks in `refuseCreate` refuse session create as not ready, and those in `refuseList` refuse
 * the session query. The sets may change between passes.
 */
function gatewayWith(refuseCreate: Set<string>, refuseList: Set<string> = new Set()) {
  const calls: Call[] = [];
  const gateway: TrunkQueueGateway = {
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      const agentId = String(params.agentId);
      if (method === "sessions.list") {
        if (refuseList.has(agentId)) {
          throw notReady(agentId);
        }
        return { sessions: [] } as T;
      }
      if (method === "sessions.create" && refuseCreate.has(agentId)) {
        throw notReady(agentId);
      }
      if (method === "agent.wait") {
        return { runId: params.runId, status: "ok" } as T;
      }
      return {} as T;
    },
  };
  return { gateway, calls };
}

const callsTo = (calls: Call[], method: string) => calls.filter((call) => call.method === method);

let dir = "";
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-trunk-unavailable-"));
  env = { BRANCH_STATE_DIR: dir };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Trunk queue with a builder that is not ready", () => {
  it("keeps the healthy builders working, skips the one not ready, and names it once", async () => {
    for (const title of ["first job", "second job", "third job"]) {
      addQueueItem({ title, brief_text: `brief for ${title}` }, env, 1);
    }
    const { gateway, calls } = gatewayWith(new Set(["builder-cedar"]));
    const logs: string[] = [];
    const availability: TrunkAvailability = {
      unavailable: new Map(),
      report: trunkAvailabilityLogger((message) => logs.push(message)),
    };
    const agentIds = ["builder-ash", "builder-birch", "builder-cedar"];

    // Six passes, 15 seconds apart: the not-ready Trunk is retried only after its backoff.
    let now = 1_000;
    for (let pass = 0; pass < 6; pass += 1) {
      await wakeIdleTrunks({ agentIds, gateway, env, now: () => now, availability });
      now += 15_000;
    }

    // The two healthy builders each took one job and started it.
    expect(callsTo(calls, "chat.send").map((call) => call.params.agentId)).toEqual([
      "builder-ash",
      "builder-birch",
    ]);
    // The not-ready builder was asked twice (first pass, then after the backoff), never with a successful start.
    expect(
      callsTo(calls, "sessions.create").filter((call) => call.params.agentId === "builder-cedar"),
    ).toHaveLength(2);
    // Its refused job goes back without a failed attempt, so it is never blocked for that.
    const third = listQueueItems(env).find((row) => row.title === "third job");
    expect(third).toMatchObject({ status: "released" });
    expect(third?.failures ?? 0).toBe(0);
    expect(listQueueItems(env).some((row) => row.blocked_reason)).toBe(false);
    // The log names the Trunk once across all passes.
    expect(logs.filter((message) => message.includes("builder-cedar"))).toHaveLength(1);
    expect(logs[0]).toContain("builder-cedar is not ready");
  });

  it("logs once when the not-ready builder recovers, and it takes the job after its backoff", async () => {
    addQueueItem({ title: "only job", brief_text: "brief" }, env, 1);
    const refuseCreate = new Set(["builder-cedar"]);
    const { gateway, calls } = gatewayWith(refuseCreate);
    const logs: string[] = [];
    const availability: TrunkAvailability = {
      unavailable: new Map(),
      report: trunkAvailabilityLogger((message) => logs.push(message)),
    };
    const agentIds = ["builder-cedar"];

    await wakeIdleTrunks({ agentIds, gateway, env, now: () => 1_000, availability });
    expect(callsTo(calls, "chat.send")).toHaveLength(0);

    refuseCreate.delete("builder-cedar");
    await wakeIdleTrunks({
      agentIds,
      gateway,
      env,
      now: () => 1_000 + UNAVAILABLE_RETRY_MS,
      availability,
    });

    expect(callsTo(calls, "chat.send").map((call) => call.params.agentId)).toEqual([
      "builder-cedar",
    ]);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("builder-cedar is not ready");
    expect(logs[1]).toContain("builder-cedar is ready again");
  });

  it("does not claim a job for a Trunk still inside its backoff", async () => {
    addQueueItem({ title: "waiting job", brief_text: "brief" }, env, 1);
    const { gateway, calls } = gatewayWith(new Set(["builder-cedar"]));
    const availability: TrunkAvailability = { unavailable: new Map() };

    await wakeIdleTrunks({
      agentIds: ["builder-cedar"],
      gateway,
      env,
      now: () => 1_000,
      availability,
    });
    const attemptsAfterFirstPass = callsTo(calls, "sessions.create").length;
    await wakeIdleTrunks({
      agentIds: ["builder-cedar"],
      gateway,
      env,
      now: () => 2_000,
      availability,
    });

    expect(callsTo(calls, "sessions.create")).toHaveLength(attemptsAfterFirstPass);
    expect(listQueueItems(env)[0].claimed_by).toBeUndefined();
  });
});

describe("Trunk queue claims held by a builder that is not ready", () => {
  it("releases a claim whose builder stopped answering only after the stale window", async () => {
    addQueueItem({ title: "claimed job", brief_text: "brief" }, env, 1);
    claimNextQueueItem("builder-ash", env, 1_000);
    const { gateway } = gatewayWith(new Set(), new Set(["builder-ash"]));

    await releaseStaleQueueClaims({
      gateway,
      env,
      now: () => 1_000 + STALE_CLAIM_MS - 1,
    });
    expect(listQueueItems(env)[0]).toMatchObject({ status: "claimed", claimed_by: "builder-ash" });

    await releaseStaleQueueClaims({ gateway, env, now: () => 1_000 + STALE_CLAIM_MS });
    const released = listQueueItems(env)[0];
    expect(released).toMatchObject({ status: "released", released_from: "builder-ash" });
    expect(released.failures ?? 0).toBe(0);
  });

  it("leaves an orphan-looking claim alone while its builder is not answering", async () => {
    addQueueItem({ title: "claimed job", brief_text: "brief" }, env, 1);
    claimNextQueueItem("builder-ash", env, 1_000);
    const { gateway } = gatewayWith(new Set(), new Set(["builder-ash"]));

    await expect(
      releaseOrphanQueueClaims({
        gateway,
        env,
        now: () => 1_000 + ORPHAN_CLAIM_GRACE_MS + 1,
      }),
    ).resolves.toBeUndefined();

    expect(listQueueItems(env)[0]).toMatchObject({ status: "claimed", claimed_by: "builder-ash" });
  });
});
