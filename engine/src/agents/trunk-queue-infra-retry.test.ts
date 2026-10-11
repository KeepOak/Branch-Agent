import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onTrunkRunLifecycle, trunkQueueHandlers } from "../gateway/server-methods/trunk-queue.js";
import {
  addQueueItem,
  claimNextQueueItem,
  isRetryableInfrastructureError,
  listQueueItems,
  MAX_CLAIM_FAILURES,
  pickUpQueuedWork,
  UNAVAILABLE_RETRY_MS,
  type TrunkQueueGateway,
} from "./trunk-queue.js";

// The release handler wakes idle Trunks through the gateway's own client; no gateway runs in this test.
vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(async () => {
    throw new Error("no gateway in this test");
  }),
}));

type Call = { method: string; params: Record<string, unknown> };

/** An idle gateway that records calls; chatSendError, when set, is what chat.send rejects with. */
function fakeGateway(chatSendError?: unknown) {
  const calls: Call[] = [];
  const gateway: TrunkQueueGateway = {
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "sessions.list") {
        return { sessions: [] } as T;
      }
      if (method === "chat.send" && chatSendError !== undefined) {
        throw chatSendError;
      }
      return {} as T;
    },
  };
  return { gateway, calls };
}

const briefs = (calls: Call[]) => calls.filter((call) => call.method === "chat.send").length;
const rowById = (id: string) => listQueueItems().find((row) => row.id === id);

const STARTUP_NOT_DONE =
  "Agent builder-ash has not completed startup inspection and preparation. Retry shortly.";
const SUSPENDED = "sessions.list unavailable during gateway suspension";

/** One claim of the job whose run started (or not) and then ended in an error. */
async function failRun(gateway: TrunkQueueGateway, error: unknown, started = true) {
  const threadKey = claimNextQueueItem("builder-ash", undefined, Date.now())?.thread_key;
  expect(threadKey).toBeDefined();
  if (started) {
    await onTrunkRunLifecycle({ agentId: "builder-ash", terminal: false, threadKey, gateway });
  }
  await onTrunkRunLifecycle({
    agentId: "builder-ash",
    terminal: true,
    threadKey,
    outcome: "failed",
    error,
    gateway,
  });
}

let dir = "";
const savedStateDir = process.env.BRANCH_STATE_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-trunk-infra-retry-"));
  process.env.BRANCH_STATE_DIR = dir;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
  if (savedStateDir === undefined) {
    delete process.env.BRANCH_STATE_DIR;
  } else {
    process.env.BRANCH_STATE_DIR = savedStateDir;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Trunk queue: gateway restarts and unfinished startup are not job failures", () => {
  it("never blocks a job whose runs fail on a gateway suspension or an unfinished Trunk startup", async () => {
    const job = addQueueItem({ title: "p0 fix", brief_text: "b", priority: 1 });
    const { gateway, calls } = fakeGateway();

    for (let attempt = 0; attempt < MAX_CLAIM_FAILURES * 2; attempt += 1) {
      await failRun(gateway, attempt % 2 ? SUSPENDED : STARTUP_NOT_DONE);
      vi.setSystemTime(Date.now() + UNAVAILABLE_RETRY_MS);
    }

    const row = rowById(job.id);
    expect(row?.failures ?? 0).toBe(0);
    expect(row?.blocked_reason).toBeUndefined();
    expect(row?.status).toBe("released");
    // The failed run's end does not send the job straight back to the Trunk that is not ready.
    expect(briefs(calls)).toBe(0);
  });

  it("does not count a run that never started, whatever its error", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const { gateway } = fakeGateway();

    for (let attempt = 0; attempt < MAX_CLAIM_FAILURES; attempt += 1) {
      await failRun(gateway, "Agent run failed", false);
      vi.setSystemTime(Date.now() + UNAVAILABLE_RETRY_MS);
    }

    expect(rowById(job.id)?.failures ?? 0).toBe(0);
    expect(rowById(job.id)?.status).toBe("released");
  });

  it("holds a job put back on infrastructure until the retry time, then hands it out again", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const { gateway } = fakeGateway();
    await failRun(gateway, STARTUP_NOT_DONE);

    expect(claimNextQueueItem("builder-ash", undefined, Date.now())).toBeUndefined();
    vi.setSystemTime(Date.now() + UNAVAILABLE_RETRY_MS);
    expect(claimNextQueueItem("builder-ash", undefined, Date.now())?.id).toBe(job.id);
  });

  it("still blocks a job after MAX_CLAIM_FAILURES started runs that failed on their own", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const { gateway } = fakeGateway();

    for (let attempt = 0; attempt < MAX_CLAIM_FAILURES; attempt += 1) {
      // A counted failure hands the job straight back to the idle Trunk; take it over from there.
      const held = rowById(job.id);
      if (held?.status === "claimed") {
        await onTrunkRunLifecycle({
          agentId: "builder-ash",
          terminal: false,
          threadKey: held.thread_key,
          gateway,
        });
        await onTrunkRunLifecycle({
          agentId: "builder-ash",
          terminal: true,
          threadKey: held.thread_key,
          outcome: "failed",
          error: "Agent run failed",
          gateway,
        });
      } else {
        await failRun(gateway, "Agent run failed");
      }
    }

    expect(rowById(job.id)?.failures).toBe(MAX_CLAIM_FAILURES);
    expect(rowById(job.id)?.status).toBe("blocked");
  });

  it("does not count a brief refused with only the suspension text, no error code", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });

    for (let attempt = 0; attempt < MAX_CLAIM_FAILURES; attempt += 1) {
      const { gateway } = fakeGateway(new Error(SUSPENDED));
      await expect(pickUpQueuedWork({ agentId: "builder-ash", gateway })).rejects.toThrow(
        SUSPENDED,
      );
    }

    expect(rowById(job.id)?.failures ?? 0).toBe(0);
    expect(rowById(job.id)?.status).toBe("released");
  });

  it("recognises the gateway's not-ready refusals by code, reason or text, and nothing else", () => {
    expect(isRetryableInfrastructureError({ gatewayCode: "UNAVAILABLE" })).toBe(true);
    expect(isRetryableInfrastructureError({ details: { reason: "gateway-restarting" } })).toBe(
      true,
    );
    expect(isRetryableInfrastructureError({ details: { reason: "gateway-suspending" } })).toBe(
      true,
    );
    expect(isRetryableInfrastructureError(STARTUP_NOT_DONE)).toBe(true);
    expect(isRetryableInfrastructureError(new Error(SUSPENDED))).toBe(true);
    expect(isRetryableInfrastructureError("chat.send unavailable during gateway restart")).toBe(
      true,
    );
    expect(
      isRetryableInfrastructureError(new Error("gateway closed (1012): service restart")),
    ).toBe(true);
    expect(isRetryableInfrastructureError("Agent run failed")).toBe(false);
    expect(isRetryableInfrastructureError(new Error("gateway closed (1008): policy"))).toBe(false);
    expect(isRetryableInfrastructureError({ gatewayCode: "INVALID_REQUEST" })).toBe(false);
    expect(isRetryableInfrastructureError(undefined)).toBe(false);
  });
});

describe("trunks.queue.release", () => {
  async function release(id: string) {
    const respond = vi.fn();
    const handler = trunkQueueHandlers["trunks.queue.release"];
    expect(handler).toBeDefined();
    await handler!({
      params: { id },
      respond,
      context: { getRuntimeConfig: () => undefined, logGateway: { warn: () => {} } },
    } as unknown as Parameters<NonNullable<typeof handler>>[0]);
    return respond.mock.calls[0];
  }

  it("reports unblocked: true when it clears a blocked job", async () => {
    const job = addQueueItem({ title: "job", brief_text: "b", priority: 1 });
    const { gateway } = fakeGateway();
    for (let attempt = 0; attempt < MAX_CLAIM_FAILURES; attempt += 1) {
      const held = rowById(job.id);
      const threadKey =
        held?.status === "claimed"
          ? held.thread_key
          : claimNextQueueItem("builder-ash", undefined, Date.now())?.thread_key;
      await onTrunkRunLifecycle({ agentId: "builder-ash", terminal: false, threadKey, gateway });
      await onTrunkRunLifecycle({
        agentId: "builder-ash",
        terminal: true,
        threadKey,
        outcome: "failed",
        gateway,
      });
    }
    expect(rowById(job.id)?.status).toBe("blocked");

    expect(await release(job.id)).toEqual([
      true,
      { released: false, released_from: null, unblocked: true },
    ]);
    expect(rowById(job.id)?.status).toBe("released");
    expect(rowById(job.id)?.failures).toBe(0);
  });

  it("reports released for a claimed job and unblocked: false for a job that was not blocked", async () => {
    const claimed = addQueueItem({ title: "claimed", brief_text: "b", priority: 2 });
    const waiting = addQueueItem({ title: "waiting", brief_text: "b", priority: 1 });
    claimNextQueueItem("builder-ash", undefined, Date.now());

    expect(await release(claimed.id)).toEqual([
      true,
      { released: true, released_from: "builder-ash", unblocked: false },
    ]);
    expect(await release(waiting.id)).toEqual([
      true,
      { released: false, released_from: null, unblocked: false },
    ]);
  });
});
