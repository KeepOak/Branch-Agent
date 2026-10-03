import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedSessionDeliveryPayload } from "../../infra/session-delivery-queue.records.js";
import { coreGatewayHandlers } from "./core-handlers.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

const state = vi.hoisted(() => ({
  dir: "",
  storePath: "",
  build: "build-2" as string | null,
  current: true,
  sessionId: "session-1",
  revision: "revision-1",
  external: true,
  enqueue: vi.fn(),
  admission: vi.fn(),
  readAdmission: vi.fn(),
}));
vi.mock("../../infra/delivery-queue-state-context.js", () => ({
  captureDeliveryQueueStateContext: () => ({
    stateDir: state.dir,
    workerContext: { environment: {}, admission: { assertCurrent: state.readAdmission } },
  }),
}));
vi.mock("../../infra/session-delivery-queue-storage.js", () => ({
  enqueueSessionDelivery: (...args: unknown[]) => state.enqueue(...args),
  withSessionDeliveryEnqueueAdmission: async (
    _payload: unknown,
    _context: unknown,
    run: (assert: () => void) => unknown,
  ) => run(state.admission),
}));
vi.mock("../../config/sessions/paths.js", () => ({
  resolveSessionStorePathCore: () => state.storePath,
}));
vi.mock("../../config/sessions/session-entry-read-runtime.js", () => ({
  withSessionEntryReadOnlyInWorker: async (
    _scope: unknown,
    assert: () => void,
    read: (value: unknown) => unknown,
  ) => {
    assert();
    return read({
      ok: true,
      value: { sessionId: state.sessionId, lifecycleRevision: state.revision },
    });
  },
}));
vi.mock("../../version.js", () => ({ resolveRuntimeServiceBuildId: () => state.build }));
vi.mock("../session-utils.js", () => ({
  loadGatewaySessionEntryReadOnly: () => ({
    canonicalKey: "agent:dev:original",
    agentId: "dev",
    storePath: state.storePath,
    entry: {
      sessionId: state.sessionId,
      lifecycleRevision: state.revision,
      delivery: state.external
        ? {
            kind: "external",
            context: {
              channel: "telegram",
              to: "original-user",
              accountId: "original-account",
              threadId: 42,
            },
            origin: { provider: "telegram", chatType: "group" },
          }
        : undefined,
    },
  }),
}));

let dir: string;
beforeEach(async () => {
  vi.clearAllMocks();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-desktop-rpc-"));
  state.dir = dir;
  state.storePath = path.join(dir, "sessions.json");
  state.build = "build-2";
  state.current = true;
  state.sessionId = "session-1";
  state.revision = "revision-1";
  state.external = true;
  state.enqueue.mockImplementation(
    async (payload: QueuedSessionDeliveryPayload) => `queue:${payload.idempotencyKey}`,
  );
  state.admission.mockImplementation(() => {});
  state.readAdmission.mockImplementation(() => {});
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
const input = {
  sessionKey: "agent:dev:original",
  expectedSessionId: "session-1",
  targetBuild: "build-2",
  checkpoint: "Saved checkpoint",
  message: "Continue the task",
};
async function invoke(
  method: string,
  params: unknown,
  options: {
    profileId?: string;
    scopes?: string[];
    invalidated?: boolean;
    hasCurrentClientAuthority?: () => boolean;
  } = {},
) {
  const respond = vi.fn();
  // Exercise the production descriptor -> lazy family -> endpoint registration.
  const handler = coreGatewayHandlers[method]!;
  await handler({
    req: { type: "req", id: "request", method, params },
    params,
    respond,
    client: {
      connect: { scopes: options.scopes ?? ["operator.admin"] },
      ...(options.profileId ? { authenticatedUserProfile: { profileId: options.profileId } } : {}),
      invalidated: options.invalidated,
    },
    context: { getRuntimeConfig: () => ({}) },
    hasCurrentClientAuthority: options.hasCurrentClientAuthority,
  } as unknown as GatewayRequestHandlerOptions);
  return respond;
}
async function prepare() {
  const reply = await invoke("desktop.continuation.prepare", input);
  expect(reply.mock.calls[0]![0]).toBe(true);
  return reply.mock.calls[0]![1];
}
describe("desktop continuation production endpoints", () => {
  it("prepares an inert durable receipt and resumes the original group/account/thread rather than caller route hints", async () => {
    const reply = await invoke("desktop.continuation.prepare", {
      ...input,
      route: { channel: "wrong", to: "new-default" },
      requester: "someone-else",
    });
    const receipt = reply.mock.calls[0]![1];
    expect(state.enqueue).not.toHaveBeenCalled();
    expect((await invoke("desktop.continuation.resume", { receipt })).mock.calls[0]).toEqual([
      true,
      { status: "accepted" },
    ]);
    expect(state.enqueue.mock.calls[0]![0]).toMatchObject({
      kind: "agentTurn",
      sessionKey: input.sessionKey,
      route: {
        channel: "telegram",
        to: "original-user",
        accountId: "original-account",
        threadId: "42",
        chatType: "group",
      },
      requesterBinding: {
        sessionId: "session-1",
        lifecycleRevision: "revision-1",
        storePath: state.storePath,
      },
      completionRetention: "permanent",
      idempotencyKey: `desktop-restart:${receipt.id}`,
    });
  });
  it.each([{ scopes: ["operator.write"] }, { profileId: "person-admin" }, { invalidated: true }])(
    "denies unauthorized or revoked requesters before receipt storage: %j",
    async (options) => {
      const reply = await invoke("desktop.continuation.prepare", input, options);
      expect(reply.mock.calls[0]![0]).toBe(false);
      expect(await fs.readdir(dir)).toEqual([]);
      expect(state.enqueue).not.toHaveBeenCalled();
    },
  );
  it("reauthorizes across async receipt IO rather than relying on the initial owner check", async () => {
    const receipt = await prepare();
    let checks = 0;
    const reply = await invoke(
      "desktop.continuation.resume",
      { receipt },
      { hasCurrentClientAuthority: () => ++checks < 4 },
    );
    expect(reply.mock.calls[0]![0]).toBe(false);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it("returns session-changed after same-session lifecycle reset, with no turn replay", async () => {
    const receipt = await prepare();
    state.revision = "revision-2";
    expect((await invoke("desktop.continuation.resume", { receipt })).mock.calls[0]).toEqual([
      true,
      { status: "session-changed" },
    ]);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it("retains requester authority at the durable queue's commit admission after async enqueue preparation", async () => {
    const receipt = await prepare();
    state.enqueue.mockImplementationOnce(async (_payload, workerContext) => {
      await Promise.resolve();
      state.current = false;
      workerContext.admission.assertCurrent();
      throw new Error("unreachable: revoked commit was admitted");
    });
    const reply = await invoke(
      "desktop.continuation.resume",
      { receipt },
      {
        hasCurrentClientAuthority: () => state.current,
      },
    );
    expect(reply.mock.calls[0]![0]).toBe(false);
    expect(reply.mock.calls[0]![2].message).toContain("requester authority changed");
    const saved = JSON.parse(
      await fs.readFile(
        path.join(dir, "desktop-restart-continuations", `${receipt.id}.json`),
        "utf8",
      ),
    );
    expect(saved.phase).toBe("prepared");
  });
  it("rejects an old build and retains the receipt for retry on the actual target build", async () => {
    const receipt = await prepare();
    state.build = "old-build";
    expect((await invoke("desktop.continuation.resume", { receipt })).mock.calls[0]![0]).toBe(
      false,
    );
    expect(state.enqueue).not.toHaveBeenCalled();
    state.build = "build-2";
    expect((await invoke("desktop.continuation.resume", { receipt })).mock.calls[0]).toEqual([
      true,
      { status: "accepted" },
    ]);
  });
  it("cancels rollback permanently and never replays after a later candidate boot", async () => {
    const receipt = await prepare();
    expect((await invoke("desktop.continuation.cancel", { receipt })).mock.calls[0]).toEqual([
      true,
      { status: "cancelled" },
    ]);
    expect((await invoke("desktop.continuation.resume", { receipt })).mock.calls[0]).toEqual([
      true,
      { status: "cancelled" },
    ]);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it("retains durable acceptance after a lost response even when the session resets", async () => {
    const receipt = await prepare();
    await invoke("desktop.continuation.resume", { receipt });
    state.sessionId = "session-2";
    state.revision = "revision-2";
    expect((await invoke("desktop.continuation.resume", { receipt })).mock.calls[0]).toEqual([
      true,
      { status: "accepted" },
    ]);
    expect(state.enqueue).toHaveBeenCalledTimes(1);
  });
  it("routes an internal conversation to its original canonical key", async () => {
    state.external = false;
    const receipt = await prepare();
    await invoke("desktop.continuation.resume", { receipt });
    expect(state.enqueue.mock.calls[0]![0].route).toMatchObject({
      to: input.sessionKey,
      chatType: "direct",
    });
  });
});
