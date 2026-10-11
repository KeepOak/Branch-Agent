import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onTrunkRunLifecycle } from "../gateway/server-methods/trunk-queue.js";
import { isTrunkNotReadyRunFailure } from "./trunk-queue-status.js";
import {
  addQueueItem,
  claimNextQueueItem,
  closeQueueClaimForThread,
  listQueueItems,
  MAX_CLAIM_FAILURES,
  pickUpQueuedWork,
  reconcileTrunkQueue,
  UNAVAILABLE_RETRY_MS,
  type TrunkQueueGateway,
} from "./trunk-queue.js";

type Call = { method: string; params: Record<string, unknown> };

/** A gateway where every Trunk is idle: sessions.list returns no live rows. */
function idleGateway() {
  const calls: Call[] = [];
  const gateway: TrunkQueueGateway = {
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "sessions.list") {
        return { sessions: [] } as T;
      }
      return {} as T;
    },
  };
  return { gateway, calls };
}

function briefedThreads(calls: Call[]): string[] {
  return calls
    .filter((call) => call.method === "chat.send")
    .map((call) => String(call.params.sessionKey));
}

function rowById(id: string) {
  return listQueueItems().find((row) => row.id === id);
}

// The live failure a queued brief met on a Trunk that was still getting ready (session run error text).
const STARTUP_RACE = "prepared model runtime publication was superseded for /scratch/agents/builder";

let dir = "";
const savedStateDir = process.env.BRANCH_STATE_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-trunk-not-ready-"));
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

describe("Trunk queue auto-claim after a Trunk that was not ready", () => {
  it("puts the card back without a failed attempt and an idle builder claims it with no dispatch message", async () => {
    const card = addQueueItem({ title: "card", brief_text: "build it", priority: 1 });
    const first = claimNextQueueItem("builder-cedar");
    const { gateway, calls } = idleGateway();

    await onTrunkRunLifecycle({
      agentId: "builder-cedar",
      terminal: true,
      threadKey: first?.thread_key,
      outcome: "failed",
      error: STARTUP_RACE,
      gateway,
    });

    // The card is not charged, and the Trunk that was not ready does not take it straight back.
    expect(rowById(card.id)?.failures ?? 0).toBe(0);
    expect(rowById(card.id)?.status).toBe("released");
    expect(briefedThreads(calls)).toEqual([]);

    // The periodic sweep, with no dispatch message, hands the card to the next idle builder.
    await reconcileTrunkQueue({
      gateway,
      agentIds: async () => ["builder-cedar", "builder-oak"],
    });

    const row = rowById(card.id);
    expect(row?.status).toBe("claimed");
    expect(row?.claimed_by).toBe("builder-oak");
    expect(briefedThreads(calls)).toEqual([row?.thread_key]);
  });

  it("never blocks a card that only met Trunks that were not ready", async () => {
    const card = addQueueItem({ title: "card", brief_text: "build it", priority: 1 });
    const { gateway } = idleGateway();

    for (let attempt = 0; attempt <= MAX_CLAIM_FAILURES; attempt += 1) {
      const agentId = `builder-ready-${attempt}`;
      const claim = claimNextQueueItem(agentId);
      expect(claim?.id).toBe(card.id);
      await onTrunkRunLifecycle({
        agentId,
        terminal: true,
        threadKey: claim?.thread_key,
        outcome: "failed",
        error: `prepared reply dispatch runtime owner was not published for ${agentId}`,
        gateway,
      });
    }

    expect(rowById(card.id)?.status).toBe("released");
    expect(rowById(card.id)?.failures ?? 0).toBe(0);
  });

  it("leaves a Trunk that keeps failing as not ready out of pickup for longer each time", async () => {
    addQueueItem({ title: "card", brief_text: "build it", priority: 1 });
    const { gateway } = idleGateway();
    const agentId = "builder-maple";
    const start = 1_000;
    const first = claimNextQueueItem(agentId, undefined, start);
    closeQueueClaimForThread(first!.thread_key, "not_ready", undefined, start);

    const retry = start + UNAVAILABLE_RETRY_MS;
    expect(await pickUpQueuedWork({ agentId, gateway, now: () => retry - 1 })).toBeUndefined();
    const second = await pickUpQueuedWork({ agentId, gateway, now: () => retry });
    expect(second).toBeDefined();

    closeQueueClaimForThread(second!.threadKey, "not_ready", undefined, retry);
    expect(
      await pickUpQueuedWork({ agentId, gateway, now: () => retry + UNAVAILABLE_RETRY_MS }),
    ).toBeUndefined();
    expect(
      await pickUpQueuedWork({ agentId, gateway, now: () => retry + 2 * UNAVAILABLE_RETRY_MS }),
    ).toBeDefined();
  });

  it("still counts a run that failed on its own as a failed attempt", async () => {
    const card = addQueueItem({ title: "card", brief_text: "build it", priority: 1 });
    const claim = claimNextQueueItem("builder-spruce");
    const { gateway } = idleGateway();

    await onTrunkRunLifecycle({
      agentId: "builder-spruce",
      terminal: true,
      threadKey: claim?.thread_key,
      outcome: "failed",
      error: "provider refused the request",
      gateway,
    });

    expect(rowById(card.id)?.failures).toBe(1);
  });

  it("recognises the not-ready failures and nothing else", () => {
    expect(isTrunkNotReadyRunFailure(STARTUP_RACE)).toBe(true);
    expect(isTrunkNotReadyRunFailure("Agent run failed", "state_contention")).toBe(true);
    expect(isTrunkNotReadyRunFailure({ gatewayCode: "UNAVAILABLE", message: "busy" })).toBe(true);
    expect(
      isTrunkNotReadyRunFailure(
        "Branch Agent state at C:\\state\\branch.sqlite is undergoing offline maintenance; retry when it finishes.",
      ),
    ).toBe(true);
    expect(isTrunkNotReadyRunFailure("404 not_found_error: model: claude-opus-5-5")).toBe(true);
    expect(
      isTrunkNotReadyRunFailure("Agent builder-ash preparation watchdog expired after 120000ms"),
    ).toBe(true);
    expect(isTrunkNotReadyRunFailure("provider refused the request")).toBe(false);
    expect(isTrunkNotReadyRunFailure(undefined)).toBe(false);
  });
});
