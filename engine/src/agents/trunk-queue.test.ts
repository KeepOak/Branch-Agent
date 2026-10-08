import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onTrunkRunLifecycle } from "../gateway/server-methods/trunk-queue.js";
import {
  addQueueItem,
  listQueueItems,
  markQueueItemDone,
  pickUpQueuedWork,
  STALE_CLAIM_MS,
  touchQueueClaim,
  type TrunkQueueGateway,
} from "./trunk-queue.js";

type Call = { method: string; params: Record<string, unknown> };

function fakeGateway(working: Set<string> = new Set()) {
  const calls: Call[] = [];
  const gateway: TrunkQueueGateway = {
    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "sessions.list") {
        const busy = working.has(String(params.agentId));
        return {
          sessions: [
            {
              key: `agent:${String(params.agentId)}:main`,
              ...(busy ? { hasActiveRun: true } : {}),
            },
          ],
        } as T;
      }
      if (method === "chat.send") {
        // Let another pickup interleave between the claim and the send, as a real round trip does.
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
        return { runId: `run-${String(params.sessionKey)}`, status: "started" } as T;
      }
      return {} as T;
    },
  };
  return { gateway, calls };
}

let dir = "";
let env: NodeJS.ProcessEnv = {};
const savedStateDir = process.env.BRANCH_STATE_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-trunk-queue-"));
  env = { ...process.env, BRANCH_STATE_DIR: dir };
  // onTrunkRunLifecycle reads the gateway's own state folder.
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

describe("Trunk job queue pickup", () => {
  it("hands an idle Trunk the higher-priority job in a new thread titled with the job", async () => {
    addQueueItem({ title: "Low job", brief_text: "Do the low job.", priority: 1 }, env, 1_000);
    const high = addQueueItem(
      { title: "High job", brief_text: "Do the high job.", priority: 5 },
      env,
      2_000,
    );
    const { gateway, calls } = fakeGateway();

    await onTrunkRunLifecycle({ agentId: "birch", terminal: true, gateway });

    const thread = `agent:birch:queue-${high.id}`;
    expect(calls.map((call) => call.method)).toEqual([
      "sessions.list",
      "sessions.create",
      "chat.send",
    ]);
    expect(calls[1]!.params).toEqual({ key: thread, agentId: "birch", label: "High job" });
    expect(calls[2]!.params).toMatchObject({
      sessionKey: thread,
      agentId: "birch",
      message: "Do the high job.",
      deliver: false,
    });
    const listed = listQueueItems(env);
    expect(listed.map((item) => [item.title, item.status, item.claimed_by])).toEqual([
      ["High job", "claimed", "birch"],
      ["Low job", "queued", undefined],
    ]);
  });

  it("gives two Trunks that finish at once different jobs, never the same one", async () => {
    addQueueItem({ title: "First", brief_text: "one", priority: 3 }, env, 1_000);
    addQueueItem({ title: "Second", brief_text: "two", priority: 2 }, env, 1_001);
    const { gateway, calls } = fakeGateway();

    const [a, b] = await Promise.all([
      pickUpQueuedWork({ agentId: "ash", gateway, env }),
      pickUpQueuedWork({ agentId: "birch", gateway, env }),
    ]);

    expect(new Set([a?.item.title, b?.item.title])).toEqual(new Set(["First", "Second"]));
    const sends = calls.filter((call) => call.method === "chat.send");
    expect(sends.map((call) => call.params.message).toSorted()).toEqual(["one", "two"]);
    const claimers = listQueueItems(env).map((item) => item.claimed_by);
    expect(claimers.toSorted()).toEqual(["ash", "birch"]);
  });

  it("does not interrupt a Trunk that is mid-run", async () => {
    addQueueItem({ title: "Waiting", brief_text: "later", priority: 1 }, env);
    const { gateway, calls } = fakeGateway(new Set(["birch"]));

    expect(await pickUpQueuedWork({ agentId: "birch", gateway, env })).toBeUndefined();

    expect(calls.map((call) => call.method)).toEqual(["sessions.list"]);
    expect(listQueueItems(env)[0]!.status).toBe("queued");
  });

  it("does nothing on an empty queue: no thread, no message", async () => {
    const { gateway, calls } = fakeGateway();

    expect(await pickUpQueuedWork({ agentId: "birch", gateway, env })).toBeUndefined();
    const done = addQueueItem({ title: "Old", brief_text: "finished" }, env);
    markQueueItemDone(done.id, env);
    expect(await pickUpQueuedWork({ agentId: "birch", gateway, env })).toBeUndefined();

    expect(calls).toEqual([]);
  });

  it("keeps one claim per Trunk at a time", async () => {
    addQueueItem({ title: "A", brief_text: "a", priority: 2 }, env);
    addQueueItem({ title: "B", brief_text: "b", priority: 1 }, env);
    const { gateway } = fakeGateway();

    expect((await pickUpQueuedWork({ agentId: "birch", gateway, env }))?.item.title).toBe("A");
    expect(await pickUpQueuedWork({ agentId: "birch", gateway, env })).toBeUndefined();
    expect(listQueueItems(env).find((item) => item.title === "B")?.status).toBe("queued");
  });

  it("releases a claim with no run activity for 2 hours and shows it as released", async () => {
    const start = 10_000;
    addQueueItem({ title: "Stuck", brief_text: "stuck", priority: 1 }, env, start);
    addQueueItem({ title: "Busy", brief_text: "busy", priority: 0 }, env, start);
    const { gateway } = fakeGateway();
    await pickUpQueuedWork({ agentId: "ash", gateway, env, now: () => start });
    await pickUpQueuedWork({ agentId: "birch", gateway, env, now: () => start });
    // birch's run keeps going; ash's claim sees no run activity.
    touchQueueClaim("birch", env, start + STALE_CLAIM_MS - 1);

    const listed = listQueueItems(env, start + STALE_CLAIM_MS);

    expect(listed.find((item) => item.title === "Stuck")).toMatchObject({
      status: "released",
      released_from: "ash",
      released_at: start + STALE_CLAIM_MS,
    });
    expect(listed.find((item) => item.title === "Stuck")?.claimed_by).toBeUndefined();
    expect(listed.find((item) => item.title === "Busy")).toMatchObject({
      status: "claimed",
      claimed_by: "birch",
    });
  });
});
