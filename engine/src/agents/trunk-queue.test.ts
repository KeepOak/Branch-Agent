import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onTrunkRunLifecycle } from "../gateway/server-methods/trunk-queue.js";
import { isTrunkQueueThreadKey } from "./trunk-queue-thread-key.js";
import {
  addQueueItem,
  claimNextQueueItem,
  listQueueItems,
  markQueueItemDone,
  pickUpQueuedWork,
  releaseQueueItem,
  releaseStaleQueueClaims,
  STALE_CLAIM_MS,
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

    await onTrunkRunLifecycle({ agentId: "builder-birch", terminal: true, gateway });

    const thread = listQueueItems(env).find((item) => item.id === high.id)?.thread_key;
    expect(thread).toMatch(new RegExp(`^agent:builder-birch:queue-${high.id}-[0-9a-f]{8}$`));
    // The skill review treats this thread as a finished job's own top-level thread, never a subagent.
    expect(isTrunkQueueThreadKey(thread)).toBe(true);
    expect(calls.map((call) => call.method)).toEqual([
      "sessions.list",
      "sessions.create",
      "chat.send",
    ]);
    expect(calls[1]!.params).toMatchObject({ key: thread, agentId: "builder-birch" });
    expect(String(calls[1]!.params.label)).toMatch(/^High job \([0-9a-f]{8}\)$/);
    expect(calls[2]!.params).toMatchObject({
      sessionKey: thread,
      agentId: "builder-birch",
      message: "Do the high job.",
      deliver: false,
    });
    const listed = listQueueItems(env);
    expect(listed.map((item) => [item.title, item.status, item.claimed_by])).toEqual([
      ["High job", "claimed", "builder-birch"],
      ["Low job", "queued", undefined],
    ]);
  });

  it("gives two Trunks that finish at once different jobs, never the same one", async () => {
    addQueueItem({ title: "First", brief_text: "one", priority: 3 }, env, 1_000);
    addQueueItem({ title: "Second", brief_text: "two", priority: 2 }, env, 1_001);
    const { gateway, calls } = fakeGateway();

    const [a, b] = await Promise.all([
      pickUpQueuedWork({ agentId: "ash", gateway, env }),
      pickUpQueuedWork({ agentId: "builder-birch", gateway, env }),
    ]);

    expect(new Set([a?.item.title, b?.item.title])).toEqual(new Set(["First", "Second"]));
    const sends = calls.filter((call) => call.method === "chat.send");
    expect(
      sends
        .map((call) => String(call.params.message))
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["one", "two"]);
    const claimers = listQueueItems(env).map((item) => item.claimed_by);
    expect(claimers.map(String).toSorted((left, right) => left.localeCompare(right))).toEqual([
      "ash",
      "builder-birch",
    ]);
  });

  it("does not interrupt a Trunk that is mid-run", async () => {
    addQueueItem({ title: "Waiting", brief_text: "later", priority: 1 }, env);
    const { gateway, calls } = fakeGateway(new Set(["builder-birch"]));

    expect(await pickUpQueuedWork({ agentId: "builder-birch", gateway, env })).toBeUndefined();

    expect(calls.map((call) => call.method)).toEqual(["sessions.list"]);
    expect(listQueueItems(env)[0]!.status).toBe("queued");
  });

  it("picks up once the Trunk's own just-ended run stops counting as active", async () => {
    addQueueItem({ title: "Next", brief_text: "next job" }, env);
    // sessions.list still shows the ended run for a moment after its end is published.
    let stillActive = 2;
    const { gateway: idle, calls } = fakeGateway();
    const gateway: TrunkQueueGateway = {
      async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
        if (method === "sessions.list" && stillActive > 0) {
          stillActive -= 1;
          calls.push({ method, params });
          return { sessions: [{ key: "agent:builder-birch:main", hasActiveRun: true }] } as T;
        }
        return await idle.request<T>(method, params);
      },
    };

    await onTrunkRunLifecycle({ agentId: "builder-birch", terminal: true, gateway });

    expect(calls.map((call) => call.method)).toEqual([
      "sessions.list",
      "sessions.list",
      "sessions.list",
      "sessions.create",
      "chat.send",
    ]);
    expect(listQueueItems(env)[0]).toMatchObject({
      status: "claimed",
      claimed_by: "builder-birch",
    });
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

  it("releases a claim with no run activity for 2 hours but keeps one whose run is still going", async () => {
    const start = 10_000;
    addQueueItem({ title: "Stuck", brief_text: "stuck", priority: 1 }, env, start);
    addQueueItem({ title: "Long run", brief_text: "long", priority: 0 }, env, start);
    claimNextQueueItem("ash", env, start);
    claimNextQueueItem("birch", env, start);
    // birch has one run going the whole time and no start/end since it claimed; ash has no run at all.
    const { gateway } = fakeGateway(new Set(["birch"]));
    const later = start + STALE_CLAIM_MS + 1;

    await releaseStaleQueueClaims({ gateway, env, now: () => later });

    const listed = listQueueItems(env);
    expect(listed.find((item) => item.title === "Stuck")).toMatchObject({
      status: "released",
      released_from: "ash",
      released_at: later,
    });
    expect(listed.find((item) => item.title === "Stuck")?.claimed_by).toBeUndefined();
    expect(listed.find((item) => item.title === "Long run")).toMatchObject({
      status: "claimed",
      claimed_by: "birch",
      active_at: later,
    });
  });

  it("recovers a queue holding only an abandoned claim through pickup alone", async () => {
    const start = 10_000;
    const job = addQueueItem({ title: "Abandoned", brief_text: "pick me up" }, env, start);
    claimNextQueueItem("ash", env, start);
    const { gateway, calls } = fakeGateway();

    const picked = await pickUpQueuedWork({
      agentId: "birch",
      gateway,
      env,
      now: () => start + STALE_CLAIM_MS + 1,
    });

    expect(picked?.item.id).toBe(job.id);
    expect(calls.map((call) => [call.method, call.params.agentId ?? null])).toEqual([
      ["sessions.list", "ash"],
      ["sessions.list", "birch"],
      ["sessions.create", "birch"],
      ["chat.send", "birch"],
    ]);
    expect(listQueueItems(env)[0]).toMatchObject({ claimed_by: "birch", released_from: "ash" });
  });

  it("never lets a released claim's late failure release the next Trunk's claim", async () => {
    const job = addQueueItem({ title: "Contested", brief_text: "contested" }, env);
    let rejectAshSend: (error: Error) => void = () => {};
    const sends: Array<Record<string, unknown>> = [];
    const { gateway: idle } = fakeGateway();
    const gateway: TrunkQueueGateway = {
      async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
        if (method === "chat.send") {
          sends.push(params);
          if (params.agentId === "ash") {
            return await new Promise<T>((_resolve, reject) => {
              rejectAshSend = reject;
            });
          }
        }
        return await idle.request<T>(method, params);
      },
    };

    const ash = pickUpQueuedWork({ agentId: "ash", gateway, env });
    await vi.waitFor(() => expect(sends).toHaveLength(1));
    expect(releaseQueueItem(job.id, env)?.claimed_by).toBe("ash");
    const birch = await pickUpQueuedWork({ agentId: "birch", gateway, env });
    expect(birch?.item.id).toBe(job.id);
    rejectAshSend(new Error("ash's send failed late"));
    await expect(ash).rejects.toThrow("ash's send failed late");

    expect(listQueueItems(env)[0]).toMatchObject({ status: "claimed", claimed_by: "birch" });
    // The reassigned job went to a new thread with its own run id, not ash's attempt.
    expect(sends[1]!.sessionKey).not.toBe(sends[0]!.sessionKey);
    expect(sends[1]!.idempotencyKey).not.toBe(sends[0]!.idempotencyKey);
  });

  it("sends nothing for a claim released while its thread was being created", async () => {
    const job = addQueueItem({ title: "Released", brief_text: "released" }, env);
    let finishCreate: () => void = () => {};
    const { gateway: idle, calls } = fakeGateway();
    const gateway: TrunkQueueGateway = {
      async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
        if (method === "sessions.create") {
          calls.push({ method, params });
          await new Promise<void>((resolve) => {
            finishCreate = resolve;
          });
          return {} as T;
        }
        return await idle.request<T>(method, params);
      },
    };

    const ash = pickUpQueuedWork({ agentId: "ash", gateway, env });
    await vi.waitFor(() => expect(calls.map((call) => call.method)).toContain("sessions.create"));
    releaseQueueItem(job.id, env);
    finishCreate();

    expect(await ash).toBeUndefined();
    expect(calls.map((call) => call.method)).not.toContain("chat.send");
    expect(listQueueItems(env)[0]).toMatchObject({ status: "released", released_from: "ash" });
  });
});
