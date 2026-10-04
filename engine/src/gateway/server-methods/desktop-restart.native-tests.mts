import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { GatewayClient, GatewayRequestContext } from "./types.js";

// Actual source fixtures: SQLite session ownership, real agent/chat and reply
// registries, normal request router/authorization and protocol validators.
// Execution is never reached. No established dependency is replaced or stubbed.
async function fixture(run: (f: any) => Promise<void>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "desktop-restart-real-"));
  const priorState = process.env.BRANCH_STATE_DIR,
    priorBuild = process.env.BRANCH_DESKTOP_ENGINE_BUILD_SHA256;
  process.env.BRANCH_STATE_DIR = dir;
  process.env.BRANCH_DESKTOP_ENGINE_BUILD_SHA256 = "a".repeat(64);
  const [
    { replaceSessionEntrySync },
    { setRuntimeConfigSnapshot },
    { registerChatAbortController },
    { createChatRunState },
    { desktopRestartHandlers },
    { handleGatewayRequest },
    { createReplyOperation },
    { closeBranchAgentDatabasesAsync },
    { closeBranchStateDatabaseAsync },
    { resetGatewayWorkAdmission },
  ] = await Promise.all([
    import("../../config/sessions/session-accessor.js"),
    import("../../config/runtime-snapshot.js"),
    import("../chat-abort.js"),
    import("../server-chat-state.js"),
    import("./desktop-restart.js"),
    import("../server-methods.js"),
    import("../../auto-reply/reply/reply-run-registry.operation.js"),
    import("../../state/branch-agent-db.js"),
    import("../../state/branch-state-db.js"),
    import("../../process/gateway-work-admission.js"),
  ]);
  const cfg = { agents: { defaults: { workspace: path.join(dir, "workspace") } } };
  setRuntimeConfigSnapshot(cfg);
  const scope = {
    agentId: "main",
    sessionKey: "agent:main:task",
    sessionId: "session-a",
    env: { BRANCH_STATE_DIR: dir },
  };
  const seed = (patch = {}) =>
    replaceSessionEntrySync(scope, {
      sessionId: scope.sessionId,
      lifecycleRevision: "life-a",
      updatedAt: Date.now(),
      status: "running",
      lifecycleRunId: "original-run",
      ...patch,
    });
  seed();
  const context = {
    getRuntimeConfig: () => cfg,
    dedupe: new Map(),
    chatAbortControllers: new Map(),
    chatQueuedTurns: new Map(),
    cron: { getSuspensionBlockerCount: () => 0 },
    chatRunState: createChatRunState(),
    agentRunSeq: new Map(),
    logGateway: { warn() {}, info() {}, debug() {}, error() {} },
  } as unknown as GatewayRequestContext;
  const client: GatewayClient = {
    connect: {
      minProtocol: 1,
      maxProtocol: 99,
      client: { id: "branch-control-ui", mode: "ui", version: "test", platform: "darwin" },
      role: "operator",
      scopes: ["operator.admin", "operator.write", "operator.read"],
      device: {
        id: "fixture-device",
        publicKey: "fixture",
        signature: "fixture",
        signedAt: 1,
        nonce: "fixture",
      },
    },
    internal: { authenticatedControlUi: true, authenticatedOperator: true },
    connId: "fixture-connection",
  };
  const { attachGatewayLocalUserIngress, prepareGatewayLocalUserIngress } =
    await import("../local-user-ingress.js");
  attachGatewayLocalUserIngress(
    client,
    prepareGatewayLocalUserIngress({
      authMethod: "token",
      authenticatedUserExpected: false,
      pairedDeviceId: "fixture-device",
      isLocalClient: true,
    }),
  );
  const request = {
    sessionKey: scope.sessionKey,
    expectedSessionId: scope.sessionId,
    lifecycleGeneration: "fixture-attempt",
    targetBuild: "a".repeat(64),
    message: "Continue the authorized task",
    checkpoint: "Exact fixture checkpoint",
  };
  let current = true;
  const { captureDesktopRestartRequester } = await import("./desktop-restart.js");
  const actor = captureDesktopRestartRequester(client);
  const options = (
    operation: string,
    params: Record<string, unknown>,
    response: (value: any) => void,
  ) => ({
    req: {
      type: "req" as const,
      id: "fixture-rpc",
      method: `desktop.restart.${operation}`,
      params,
    },
    params,
    context,
    client,
    isWebchatConnect: () => true,
    hasCurrentClientAuthority: () => current,
    respond: (ok: boolean, payload: unknown, error: unknown) => response({ ok, payload, error }),
  });
  const call = async (
    operation: string,
    params: Record<string, unknown>,
    routed = true,
    chosenClient: GatewayClient = client,
  ) => {
    let result: any;
    const opts = options(operation, params, (value) => {
      result = value;
    });
    opts.client = chosenClient;
    if (routed) await handleGatewayRequest(opts);
    else await desktopRestartHandlers[`desktop.restart.${operation}`]!(opts);
    assert.ok(result, "actual caller must acknowledge");
    return result;
  };
  const register = (
    kind: "agent" | "chat-send" = "agent",
    sessionKey = scope.sessionKey,
    sessionId = scope.sessionId,
  ) =>
    registerChatAbortController({
      chatAbortControllers: context.chatAbortControllers,
      runId: sessionKey === scope.sessionKey ? "original-run" : "other-run",
      sessionKey,
      sessionId,
      agentId: "main",
      timeoutMs: 60_000,
      kind,
      controlUiVisible: true,
    });
  try {
    await run({
      dir,
      context,
      client,
      request,
      scope,
      seed,
      call,
      register,
      createReplyOperation,
      actor,
      revoke: () => {
        current = false;
      },
    });
  } finally {
    const { releaseDesktopRestartFence } = await import("../desktop-restart-fence.js");
    releaseDesktopRestartFence(
      { lifecycleGeneration: request.lifecycleGeneration, targetBuild: request.targetBuild },
      actor,
    );
    context.chatRunState.clear();
    context.chatAbortControllers.clear();
    resetGatewayWorkAdmission();
    await closeBranchAgentDatabasesAsync();
    await closeBranchStateDatabaseAsync();
    rmSync(dir, { recursive: true, force: true });
    if (priorState === undefined) delete process.env.BRANCH_STATE_DIR;
    else process.env.BRANCH_STATE_DIR = priorState;
    if (priorBuild === undefined) delete process.env.BRANCH_DESKTOP_ENGINE_BUILD_SHA256;
    else process.env.BRANCH_DESKTOP_ENGINE_BUILD_SHA256 = priorBuild;
  }
}

test("actual normal router prepares profile-less paired UI, keeps same receipt on lost prepare ACK and cancels its own fence", () =>
  fixture(async (f) => {
    const live = f.register();
    const first = await f.call("prepare", f.request),
      retry = await f.call("prepare", f.request);
    assert.equal(first.ok, true);
    assert.ok(first.payload.id);
    assert.deepEqual(retry.payload, first.payload);
    const { isGatewayWorkAdmissionClosed } =
      await import("../../process/gateway-work-admission.js");
    assert.equal(isGatewayWorkAdmissionClosed(), true);
    const cancel = await f.call("cancel", first.payload);
    assert.equal(cancel.payload.status, "cancelled");
    assert.equal(isGatewayWorkAdmissionClosed(), false);
    live.cleanup();
  }));
test("actual normal router minimal idle admission holds all new work until generation cancellation", () =>
  fixture(async (f) => {
    const { lifecycleGeneration, targetBuild } = f.request;
    const first = await f.call("prepare", { lifecycleGeneration, targetBuild });
    assert.deepEqual(first.payload, { status: "idle", lifecycleGeneration, targetBuild });
    const { tryBeginGatewayIndependentRootWorkAdmission } =
      await import("../../process/gateway-work-admission.js");
    assert.equal(tryBeginGatewayIndependentRootWorkAdmission("fixture:other-client"), null);
    assert.equal(
      (await f.call("cancel", { lifecycleGeneration, targetBuild })).payload.status,
      "cancelled",
    );
    const lease = tryBeginGatewayIndependentRootWorkAdmission("fixture:after-cancel");
    assert.ok(lease);
    lease.release();
    assert.equal((await f.call("prepare", { lifecycleGeneration, targetBuild })).ok, false);
  }));
test("actual canonical agent and ordinary chat registries both prevent global idle and unrelated checkpoint restart", async () => {
  for (const kind of ["agent", "chat-send"] as const)
    await fixture(async (f) => {
      const other = f.register(kind, "agent:main:other", "other-session");
      const first = await f.call("prepare", {
        lifecycleGeneration: f.request.lifecycleGeneration,
        targetBuild: f.request.targetBuild,
      });
      assert.equal(first.payload.status, "deferred");
      const second = await f.call("prepare", f.request);
      assert.equal(second.payload.status, "deferred");
      const { isGatewayWorkAdmissionClosed } =
        await import("../../process/gateway-work-admission.js");
      assert.equal(isGatewayWorkAdmissionClosed(), false);
      assert.equal(other.controller.signal.aborted, false);
      other.cleanup();
    });
});
test("actual native/auto-reply canonical registry is covered without a gateway controller", () =>
  fixture(async (f) => {
    const reply = f.createReplyOperation({
      sessionKey: "agent:main:other",
      sessionId: "other-session",
      agentId: "main",
      resetTriggered: false,
    });
    try {
      const first = await f.call("prepare", {
        lifecycleGeneration: f.request.lifecycleGeneration,
        targetBuild: f.request.targetBuild,
      });
      assert.equal(first.payload.status, "deferred");
    } finally {
      reply.complete();
    }
  }));
test("actual source refuses forged UI ingress, revoked caller and non-admin global restart without altering scopes", () =>
  fixture(async (f) => {
    f.client.connect.scopes = ["operator.write"];
    assert.equal((await f.call("prepare", f.request)).ok, false);
    assert.deepEqual(f.client.connect.scopes, ["operator.write"]);
    f.client.connect.scopes = ["operator.admin"];
    f.client.internal.syntheticClient = true;
    assert.equal((await f.call("prepare", f.request)).ok, false);
    delete f.client.internal.syntheticClient;
    f.revoke();
    assert.equal((await f.call("prepare", f.request)).ok, false);
  }));
test("actual source preserves wrong-candidate receipt and cancels completed task instead of dispatching", () =>
  fixture(async (f) => {
    const live = f.register();
    const { payload: receipt } = await f.call("prepare", f.request);
    live.cleanup();
    const { releaseDesktopRestartFence } = await import("../desktop-restart-fence.js");
    releaseDesktopRestartFence(
      { lifecycleGeneration: receipt.lifecycleGeneration, targetBuild: receipt.targetBuild },
      f.actor,
    );
    process.env.BRANCH_DESKTOP_ENGINE_BUILD_SHA256 = "b".repeat(64);
    assert.equal((await f.call("resume", receipt)).ok, false);
    process.env.BRANCH_DESKTOP_ENGINE_BUILD_SHA256 = receipt.targetBuild;
    f.seed({ status: "done", lastRunId: "original-run" });
    assert.equal((await f.call("resume", receipt)).payload.status, "cancelled");
  }));
test("actual normal agent router enforces fresh command authorization on a host-bound restart and never retries ambiguous claim", () =>
  fixture(async (f) => {
    const live = f.register();
    f.request.message = "/reset";
    const { payload: receipt } = await f.call("prepare", f.request);
    live.cleanup();
    const { releaseDesktopRestartFence } = await import("../desktop-restart-fence.js");
    releaseDesktopRestartFence(
      { lifecycleGeneration: receipt.lifecycleGeneration, targetBuild: receipt.targetBuild },
      f.actor,
    );
    f.client.connect.scopes = ["operator.write"];
    const response = await f.call("resume", receipt);
    assert.equal(response.ok, false);
    assert.match(response.error.message, /operator.admin|scope/);
    const retry = await f.call("resume", receipt);
    assert.equal(retry.payload.status, "uncertain");
    assert.equal(f.context.chatAbortControllers.size, 0);
  }));

test("actual authenticated read identity returns engine process UUID and PID with verified archive marker without closing work admission", () =>
  fixture(async (f) => {
    f.client.connect.scopes = ["operator.read"];
    const first = await f.call("identity", {}),
      second = await f.call("identity", {});
    assert.equal(first.ok, true);
    assert.equal(first.payload.targetBuild, "a".repeat(64));
    assert.equal(first.payload.pid, process.pid);
    assert.match(first.payload.processInstanceId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(second.payload, first.payload);
    const { isGatewayWorkAdmissionClosed } =
      await import("../../process/gateway-work-admission.js");
    assert.equal(isGatewayWorkAdmissionClosed(), false);
    delete process.env.BRANCH_DESKTOP_ENGINE_BUILD_SHA256;
    const missing = await f.call("identity", {});
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "UNAVAILABLE");
    process.env.BRANCH_DESKTOP_ENGINE_BUILD_SHA256 = "mutable-label";
    assert.equal((await f.call("identity", {})).ok, false);
  }));

test("actual normal router rejects generation and requester substitution without releasing the original restart fence", () =>
  fixture(async (f) => {
    const live = f.register();
    const { payload: receipt } = await f.call("prepare", f.request);
    const { isGatewayWorkAdmissionClosed } =
      await import("../../process/gateway-work-admission.js");
    assert.equal(
      (
        await f.call("cancel", {
          lifecycleGeneration: "other-attempt",
          targetBuild: receipt.targetBuild,
        })
      ).ok,
      false,
    );
    assert.equal(isGatewayWorkAdmissionClosed(), true);
    f.client.connect.device.id = "other-device";
    assert.equal((await f.call("cancel", receipt)).ok, false);
    assert.equal(isGatewayWorkAdmissionClosed(), true);
    f.client.connect.device.id = "fixture-device";
    assert.equal((await f.call("cancel", receipt)).payload.status, "cancelled");
    assert.equal(isGatewayWorkAdmissionClosed(), false);
    live.cleanup();
  }));

test("actual canonical ACP and media provider activity prevent falsely reporting global idle", async () => {
  const { markAcpTurnActive } = await import("../../acp/control-plane/active-turns.js");
  const { registerGeneratedMediaTaskActivity, clearGeneratedMediaTaskActivity } =
    await import("../../agents/media-generation-activity.js");
  for (const kind of ["acp", "media"])
    await fixture(async (f) => {
      const release =
        kind === "acp"
          ? markAcpTurnActive({ sessionKey: "agent:main:other", agentId: "main" })
          : (registerGeneratedMediaTaskActivity("media-owner", "agent:main:other", "main"),
            () => clearGeneratedMediaTaskActivity("media-owner"));
      try {
        const result = await f.call("prepare", {
          lifecycleGeneration: f.request.lifecycleGeneration,
          targetBuild: f.request.targetBuild,
        });
        assert.equal(result.payload.status, "deferred");
        const { isGatewayWorkAdmissionClosed } =
          await import("../../process/gateway-work-admission.js");
        assert.equal(isGatewayWorkAdmissionClosed(), false);
      } finally {
        release?.();
      }
    });
});

test("actual same-session canonical recovery retains its observed producer and cannot create a second restart turn", () =>
  fixture(async (f) => {
    const original = f.register();
    const { payload: receipt } = await f.call("prepare", f.request);
    original.cleanup();
    const { releaseDesktopRestartFence } = await import("../desktop-restart-fence.js");
    releaseDesktopRestartFence(
      { lifecycleGeneration: receipt.lifecycleGeneration, targetBuild: receipt.targetBuild },
      f.actor,
    );
    const { registerChatAbortController } = await import("../chat-abort.js");
    f.seed({ lifecycleRunId: "canonical-recovered-run" });
    const recovered = registerChatAbortController({
      chatAbortControllers: f.context.chatAbortControllers,
      runId: "canonical-recovered-run",
      sessionKey: f.scope.sessionKey,
      sessionId: f.scope.sessionId,
      agentId: "main",
      timeoutMs: 60_000,
      kind: "agent",
    });
    const first = await f.call("resume", receipt),
      retry = await f.call("resume", receipt);
    assert.deepEqual(first.payload, { status: "uncertain", runId: "canonical-recovered-run" });
    assert.deepEqual(retry.payload, first.payload);
    assert.equal(f.context.chatAbortControllers.size, 1);
    assert.equal(recovered.controller.signal.aborted, false);
    recovered.cleanup();
  }));
test("actual private checkpoint preparation defers before storing any private task text", () =>
  fixture(async (f) => {
    f.seed({ incognito: true });
    const live = f.register();
    f.request.checkpoint = "private-checkpoint-never-persisted";
    const result = await f.call("prepare", f.request);
    assert.equal(result.payload.status, "deferred");
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(path.join(f.dir, "desktop-restart-receipts.sqlite"));
    assert.equal(bytes.includes(Buffer.from(f.request.checkpoint)), false);
    const { isGatewayWorkAdmissionClosed } =
      await import("../../process/gateway-work-admission.js");
    assert.equal(isGatewayWorkAdmissionClosed(), false);
    live.cleanup();
  }));

test("actual router rejects copied client fields without opaque handshake-attested device proof", () =>
  fixture(async (f) => {
    const copied = {
      ...f.client,
      connect: { ...f.client.connect },
      internal: { ...f.client.internal },
    };
    assert.equal((await f.call("identity", {}, true, copied)).ok, false);
    assert.equal((await f.call("prepare", f.request, true, copied)).ok, false);
    const { isGatewayWorkAdmissionClosed } =
      await import("../../process/gateway-work-admission.js");
    assert.equal(isGatewayWorkAdmissionClosed(), false);
  }));

test("actual accepted legacy owner UI needs no new device factor, while opaque canonical subject remains required", () =>
  fixture(async (f) => {
    const { attachGatewayLocalUserIngress, prepareGatewayLocalUserIngress } =
      await import("../local-user-ingress.js");
    delete f.client.connect.device;
    attachGatewayLocalUserIngress(
      f.client,
      prepareGatewayLocalUserIngress({
        authMethod: "token",
        authenticatedUserExpected: false,
        isLocalClient: true,
      }),
    );
    const prepared = await f.call("prepare", {
      lifecycleGeneration: f.request.lifecycleGeneration,
      targetBuild: f.request.targetBuild,
    });
    assert.equal(prepared.payload.status, "idle");
    assert.equal(
      (
        await f.call("cancel", {
          lifecycleGeneration: f.request.lifecycleGeneration,
          targetBuild: f.request.targetBuild,
        })
      ).payload.status,
      "cancelled",
    );
  }));
test("actual open terminal sessions and unowned queued work defer without cancelling a terminal or stopping admission", () =>
  fixture(async (f) => {
    f.context.terminalSessions = { size: 1 };
    const idle = {
      lifecycleGeneration: f.request.lifecycleGeneration,
      targetBuild: f.request.targetBuild,
    };
    assert.equal((await f.call("prepare", idle)).payload.status, "deferred");
    const { isGatewayWorkAdmissionClosed, tryBeginGatewayIndependentRootWorkAdmission } =
      await import("../../process/gateway-work-admission.js");
    assert.equal(isGatewayWorkAdmissionClosed(), false);
    f.context.terminalSessions = undefined;
    const other = tryBeginGatewayIndependentRootWorkAdmission("unowned:request");
    assert.ok(other);
    const live = f.register();
    assert.equal((await f.call("prepare", f.request)).payload.status, "deferred");
    assert.equal(live.controller.signal.aborted, false);
    other.release();
    live.cleanup();
  }));
test("actual observer reconciles canonical durable custody and fast terminal completion without dispatching a second turn", () =>
  fixture(async (f) => {
    const live = f.register();
    const { payload: receipt } = await f.call("prepare", f.request);
    live.cleanup();
    const { releaseDesktopRestartFence } = await import("../desktop-restart-fence.js");
    releaseDesktopRestartFence(
      { lifecycleGeneration: receipt.lifecycleGeneration, targetBuild: receipt.targetBuild },
      f.actor,
    );
    const waiting = await f.call("observe", receipt);
    assert.equal(waiting.payload.status, "waiting");
    const { recordDesktopCanonicalRecoveryAdmission } =
      await import("../desktop-restart-admission.js");
    recordDesktopCanonicalRecoveryAdmission({
      sessionKey: f.scope.sessionKey,
      sessionId: f.scope.sessionId,
      lifecycleRevision: "life-a",
      sourceRunIds: ["different-original"],
      runId: "unrelated-run",
    });
    assert.equal((await f.call("observe", receipt)).payload.status, "waiting");
    recordDesktopCanonicalRecoveryAdmission({
      sessionKey: f.scope.sessionKey,
      sessionId: f.scope.sessionId,
      lifecycleRevision: "life-a",
      sourceRunIds: ["original-run"],
      runId: "canonical-recovered-run",
    });
    const recovered = await f.call("observe", receipt);
    assert.deepEqual(recovered.payload, { status: "recovered", runId: "canonical-recovered-run" });
    assert.equal((await f.call("resume", receipt)).payload.status, "uncertain");
    f.seed({ status: "done", lastRunId: "canonical-recovered-run", lifecycleRunId: undefined });
    assert.deepEqual((await f.call("observe", receipt)).payload, {
      status: "completed",
      runId: "canonical-recovered-run",
      outcome: "done",
    });
    assert.equal(f.context.chatAbortControllers.size, 0);
  }));

test("actual normal prepare covers only selected live root and reply reservation, while an unrelated root still defers", () =>
  fixture(async (f) => {
    const { tryBeginGatewayIndependentRootWorkAdmission } =
      await import("../../process/gateway-work-admission.js");
    const { createReplyDispatcher } = await import("../../auto-reply/reply/reply-dispatcher.js");
    const source = tryBeginGatewayIndependentRootWorkAdmission("actual:selected-run");
    assert.ok(source);
    let live: any, dispatcher: any;
    await source.run(async () => {
      dispatcher = createReplyDispatcher({ deliver: async () => {} });
      live = f.register();
      live.markExecutionStarted();
    });
    try {
      const first = await f.call("prepare", f.request);
      assert.equal(first.ok, true);
      assert.ok(first.payload.id);
      assert.equal((await f.call("cancel", first.payload)).payload.status, "cancelled");
      f.request.lifecycleGeneration = "fixture-second-attempt";
      const other = tryBeginGatewayIndependentRootWorkAdmission("actual:unrelated-request");
      assert.ok(other);
      try {
        assert.equal((await f.call("prepare", f.request)).payload.status, "deferred");
      } finally {
        other.release();
      }
    } finally {
      live.cleanup();
      dispatcher.markComplete();
      source.release();
    }
  }));
