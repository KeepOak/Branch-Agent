import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { onTrunkRunLifecycle } from "../gateway/server-methods/trunk-queue.js";
import { isQueueEligibleTrunk, isTrunkStartupStalled } from "./trunk-queue-policy.js";
import {
  addQueueItem,
  listQueueItems,
  pickUpQueuedWork,
  wakeIdleTrunks,
  type TrunkQueueGateway,
} from "./trunk-queue.js";

type Call = { method: string; params: Record<string, unknown> };

/** A gateway where the listed Trunks show a live run, and chat.send can be made to refuse one Trunk. */
function fakeGateway(options: { busy?: string[]; refuse?: string } = {}) {
  const busy = new Set(options.busy ?? []);
  const calls: Call[] = [];
  const gateway: TrunkQueueGateway = {
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "sessions.list") {
        const agentId = String(params.agentId);
        return {
          sessions: [
            { key: `agent:${agentId}:main`, ...(busy.has(agentId) ? { hasActiveRun: true } : {}) },
          ],
        } as T;
      }
      if (method === "chat.send") {
        if (String(params.agentId) === options.refuse) {
          throw new Error("run refused by host admission");
        }
        return { runId: `run-${String(params.sessionKey)}`, status: "started" } as T;
      }
      return {} as T;
    },
  };
  return { gateway, calls };
}

const sends = (calls: Call[]) => calls.filter((call) => call.method === "chat.send");

let dir = "";
let env: NodeJS.ProcessEnv = {};
const savedStateDir = process.env.BRANCH_STATE_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-trunk-queue-wake-"));
  env = { ...process.env, BRANCH_STATE_DIR: dir };
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

describe("Trunk queue eligibility", () => {
  it("allows builder Trunks by default and no other Trunk", () => {
    expect(isQueueEligibleTrunk("builder-ash", undefined)).toBe(true);
    expect(isQueueEligibleTrunk("mobile", undefined)).toBe(false);
    expect(isQueueEligibleTrunk("main", undefined)).toBe(false);
  });

  it("turns every Trunk off when enabled is false", () => {
    const cfg: BranchConfig = { agents: { trunkQueue: { enabled: false } } };
    expect(isQueueEligibleTrunk("builder-ash", cfg)).toBe(false);
  });

  it("uses the listed Trunks instead of the builder default when a list is set", () => {
    const cfg: BranchConfig = { agents: { trunkQueue: { agents: ["mobile"] } } };
    expect(isQueueEligibleTrunk("mobile", cfg)).toBe(true);
    expect(isQueueEligibleTrunk("builder-ash", cfg)).toBe(false);
  });
});

describe("Trunk startup state for queue pickup", () => {
  it("treats a Trunk whose startup stopped retrying as stalled", () => {
    expect(
      isTrunkStartupStalled({ admissionRefusal: { preparation: { state: "needs-attention" } } }),
    ).toBe(true);
  });

  it("does not treat a retrying or healthy Trunk as stalled", () => {
    expect(
      isTrunkStartupStalled({ admissionRefusal: { preparation: { state: "retrying" } } }),
    ).toBe(false);
    expect(isTrunkStartupStalled({ id: "builder-ash" })).toBe(false);
  });
});

describe("Trunk queue wake-up", () => {
  it("gives two idle builders the top two jobs, one each", async () => {
    addQueueItem({ title: "Low", brief_text: "low job", priority: 1 }, env, 1_000);
    addQueueItem({ title: "High", brief_text: "high job", priority: 5 }, env, 2_000);
    const { gateway, calls } = fakeGateway();

    const woken = await wakeIdleTrunks({
      agentIds: ["builder-ash", "builder-birch"],
      gateway,
      env,
    });

    expect(woken).toEqual(["builder-ash", "builder-birch"]);
    const claimed = listQueueItems(env).map((item) => [item.title, item.claimed_by]);
    expect(claimed).toEqual([
      ["High", "builder-ash"],
      ["Low", "builder-birch"],
    ]);
    expect(sends(calls).map((call) => call.params.message)).toEqual(["high job", "low job"]);
  });

  it("skips a busy builder and leaves the card for an idle one", async () => {
    addQueueItem({ title: "Next", brief_text: "next job" }, env);
    const { gateway } = fakeGateway({ busy: ["builder-ash"] });

    const woken = await wakeIdleTrunks({
      agentIds: ["builder-ash", "builder-birch"],
      gateway,
      env,
    });

    expect(woken).toEqual(["builder-birch"]);
    expect(listQueueItems(env)[0]).toMatchObject({
      status: "claimed",
      claimed_by: "builder-birch",
    });
  });

  it("makes no gateway call when the queue is empty", async () => {
    const { gateway, calls } = fakeGateway();

    expect(await wakeIdleTrunks({ agentIds: ["builder-ash"], gateway, env })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("stops the pass at the first refused run and releases that claim", async () => {
    addQueueItem({ title: "Only", brief_text: "only job" }, env);
    const { gateway, calls } = fakeGateway({ refuse: "builder-ash" });

    await expect(
      wakeIdleTrunks({ agentIds: ["builder-ash", "builder-birch"], gateway, env }),
    ).rejects.toThrow("run refused by host admission");

    expect(sends(calls).map((call) => call.params.agentId)).toEqual(["builder-ash"]);
    expect(listQueueItems(env)[0]).toMatchObject({
      status: "released",
      released_from: "builder-ash",
    });
  });

  it("starts one run when two pickups for the same Trunk overlap", async () => {
    addQueueItem({ title: "A", brief_text: "a" }, env);
    addQueueItem({ title: "B", brief_text: "b" }, env);
    const { gateway, calls } = fakeGateway();

    const [first, second] = await Promise.all([
      pickUpQueuedWork({ agentId: "builder-ash", gateway, env }),
      pickUpQueuedWork({ agentId: "builder-ash", gateway, env }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(sends(calls)).toHaveLength(1);
  });
});

describe("Trunk queue run-end pickup gate", () => {
  it("leaves the queue alone when a non-builder Trunk's run ends", async () => {
    addQueueItem({ title: "Next", brief_text: "next job" }, env);
    const { gateway, calls } = fakeGateway();

    await onTrunkRunLifecycle({ agentId: "main", terminal: true, gateway });

    expect(calls).toEqual([]);
    expect(listQueueItems(env)[0]).toMatchObject({ status: "queued" });
  });

  it("does not pick up for a builder when pickup is switched off", async () => {
    addQueueItem({ title: "Next", brief_text: "next job" }, env);
    const { gateway, calls } = fakeGateway();
    const cfg: BranchConfig = { agents: { trunkQueue: { enabled: false } } };

    await onTrunkRunLifecycle({ agentId: "builder-ash", terminal: true, cfg, gateway });

    expect(calls).toEqual([]);
    expect(listQueueItems(env)[0]).toMatchObject({ status: "queued" });
  });
});
