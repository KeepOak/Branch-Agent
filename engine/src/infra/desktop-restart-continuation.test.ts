import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopRestartContinuationStore,
  type DesktopContinuationRecord,
} from "./desktop-restart-continuation.js";
import type { QueuedSessionDeliveryPayload } from "./session-delivery-queue.records.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-desktop-continuation-"));
  dirs.push(dir);
  let owner = "gateway-owner";
  let build: string | null = "immutable-build-2";
  let current = true;
  const payloads = new Map<string, QueuedSessionDeliveryPayload>();
  const enqueue = vi.fn(async (payload: QueuedSessionDeliveryPayload) => {
    payloads.set(payload.idempotencyKey!, payload);
    return `queue:${payload.idempotencyKey}`;
  });
  const deps = {
    assertOwner(requester: string) {
      if (requester !== owner) throw new Error("owner changed");
    },
    currentBuild: () => build,
    bindingIsCurrent: vi.fn(async () => current),
    enqueue,
  };
  const create = () => new DesktopRestartContinuationStore(dir, deps);
  const input: Omit<DesktopContinuationRecord, "version" | "phase" | "id" | "queueId"> = {
    sessionKey: "agent:dev:original",
    expectedSessionId: "session-1",
    targetBuild: "immutable-build-2",
    requester: owner,
    binding: {
      agentId: "dev",
      sessionKey: "agent:dev:original",
      sessionId: "session-1",
      storePath: "/original/store",
      lifecycleRevision: "rev-1",
    },
    route: {
      channel: "telegram",
      to: "original-user",
      accountId: "original-account",
      threadId: "original-thread",
      chatType: "direct",
    },
    checkpoint: "Saved authorized checkpoint",
    message: "Continue the original task",
  };
  return {
    dir,
    input,
    create,
    deps,
    enqueue,
    payloads,
    setOwner: (v: string) => {
      owner = v;
    },
    setBuild: (v: string | null) => {
      build = v;
    },
    setCurrent: (v: boolean) => {
      current = v;
    },
  };
}
describe("desktop durable restart continuation", () => {
  it("persists an inert receipt without queueing or startup sentinel", async () => {
    const h = await setup();
    const receipt = await h.create().prepare(h.input);
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(Object.keys(receipt).sort()).toEqual([
      "expectedSessionId",
      "id",
      "sessionKey",
      "targetBuild",
    ]);
    expect(await fs.readdir(h.dir)).toEqual([`${receipt.id}.json`]);
    expect(
      JSON.parse(await fs.readFile(path.join(h.dir, `${receipt.id}.json`), "utf8")),
    ).toMatchObject({ phase: "prepared", requester: "gateway-owner" });
  });
  it("recovers a receipt in a new store and retains original route and lifecycle", async () => {
    const h = await setup();
    const receipt = await h.create().prepare(h.input);
    expect(await h.create().resume(receipt, h.input.requester)).toBe("accepted");
    expect(h.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: h.input.sessionKey,
        route: h.input.route,
        requesterBinding: h.input.binding,
        message: `${h.input.checkpoint}\n\n${h.input.message}`,
        completionRetention: "permanent",
        idempotencyKey: `desktop-restart:${receipt.id}`,
      }),
    );
  });
  it("requires the actual running target build rather than caller receipt confirmation", async () => {
    const h = await setup();
    const receipt = await h.create().prepare(h.input);
    h.setBuild("old-build");
    await expect(h.create().resume(receipt, h.input.requester)).rejects.toThrow("target build");
    h.setBuild(null);
    await expect(h.create().resume(receipt, h.input.requester)).rejects.toThrow("target build");
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it("rejects stale session lifecycle before preparation and before resume", async () => {
    const h = await setup();
    h.setCurrent(false);
    await expect(h.create().prepare(h.input)).rejects.toThrow("session-changed");
    expect(await fs.readdir(h.dir)).toEqual([]);
    h.setCurrent(true);
    const receipt = await h.create().prepare(h.input);
    h.setCurrent(false);
    expect(await h.create().resume(receipt, h.input.requester)).toBe("session-changed");
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it("reauthorizes the original requester and rejects a replacement owner", async () => {
    const h = await setup();
    const receipt = await h.create().prepare(h.input);
    h.setOwner("replacement");
    await expect(h.create().resume(receipt, h.input.requester)).rejects.toThrow("owner changed");
    await expect(h.create().resume(receipt, "replacement")).rejects.toThrow("mismatch");
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it("cannot modify receipt session or target binding", async () => {
    const h = await setup();
    const receipt = await h.create().prepare(h.input);
    await expect(
      h.create().resume({ ...receipt, sessionKey: "agent:other:new-default" }, h.input.requester),
    ).rejects.toThrow("mismatch");
    await expect(
      h.create().resume({ ...receipt, targetBuild: "different-build" }, h.input.requester),
    ).rejects.toThrow("mismatch");
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it("cancelled rollback receipt stays cancelled in a new process owner", async () => {
    const h = await setup();
    const receipt = await h.create().prepare(h.input);
    expect(await h.create().cancel(receipt, h.input.requester)).toBe("cancelled");
    expect(await h.create().resume(receipt, h.input.requester)).toBe("cancelled");
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it("retains permanent acceptance for lost acknowledgments after session reset", async () => {
    const h = await setup();
    const receipt = await h.create().prepare(h.input);
    await h.create().resume(receipt, h.input.requester);
    h.setCurrent(false);
    h.setBuild("later-build");
    expect(await h.create().resume(receipt, h.input.requester)).toBe("accepted");
    expect(await h.create().cancel(receipt, h.input.requester)).toBe("accepted");
    expect(h.enqueue).toHaveBeenCalledTimes(1);
  });
  it("retries a failed queue write without declaring accepted", async () => {
    const h = await setup();
    const receipt = await h.create().prepare(h.input);
    h.enqueue.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(h.create().resume(receipt, h.input.requester)).rejects.toThrow(
      "database unavailable",
    );
    expect(await h.create().resume(receipt, h.input.requester)).toBe("accepted");
  });
  it("retries the same permanent queue key if acceptance receipt write fails", async () => {
    const h = await setup();
    const receipt = await h.create().prepare(h.input);
    const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("receipt disk failure"));
    await expect(h.create().resume(receipt, h.input.requester)).rejects.toThrow(
      "receipt disk failure",
    );
    rename.mockRestore();
    expect(await h.create().resume(receipt, h.input.requester)).toBe("accepted");
    expect(h.payloads.size).toBe(1);
    expect(h.enqueue.mock.calls[0]![0].idempotencyKey).toBe(
      h.enqueue.mock.calls[1]![0].idempotencyKey,
    );
  });
  it("serializes independent store instances to publish only one accepted receipt", async () => {
    const h = await setup();
    const receipt = await h.create().prepare(h.input);
    expect(
      await Promise.all([
        h.create().resume(receipt, h.input.requester),
        h.create().resume(receipt, h.input.requester),
      ]),
    ).toEqual(["accepted", "accepted"]);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
  });
  it("fails closed on corrupt records and receipt path traversal", async () => {
    const h = await setup();
    const receipt = await h.create().prepare(h.input);
    await fs.writeFile(path.join(h.dir, `${receipt.id}.json`), '{"version":1}');
    await expect(h.create().resume(receipt, h.input.requester)).rejects.toThrow(
      "Invalid desktop continuation record",
    );
    await expect(
      h.create().resume({ ...receipt, id: "../../escape" }, h.input.requester),
    ).rejects.toThrow("receipt ID");
    expect(h.enqueue).not.toHaveBeenCalled();
  });
});
