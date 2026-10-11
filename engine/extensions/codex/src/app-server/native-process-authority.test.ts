import { invokeNativeHookRelay, onAgentEvent } from "branch/plugin-sdk/agent-harness-runtime";
import { acquireHostHeavyStep } from "branch/plugin-sdk/native-hook-relay-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as availableMemory from "../../../../scripts/lib/available-memory.mjs";
import { createFixtureLifetime } from "../../../../test/helpers/fixture-lifetime.js";
import { createCodexTestHostCapabilities } from "./host-capability.test-support.js";
import {
  createCodexNativeHookRelay,
  buildCodexNativeHookRelayConfig,
} from "./native-hook-relay.js";
import {
  CodexNativeProcessAuthority,
  getCodexNativeProcessClient,
} from "./native-process-authority.js";
import { createClientHarness } from "./test-support.js";

function source(requiresProcessAdmission = true) {
  const abort = new AbortController();
  const released = vi.fn();
  const failed = vi.fn();
  const host = createCodexTestHostCapabilities({
    retainSourceAuthority: () => ({
      signal: abort.signal,
      assertCurrent: () => abort.signal.throwIfAborted(),
      release: released,
    }),
  });
  const owner = new CodexNativeProcessAuthority(host, failed, requiresProcessAdmission);
  return { abort, owner, released, failed, host };
}

const command = { threadId: "thread", turnId: "turn", itemId: "command" };
const assertActive = () => {};
const metadata = { threadId: command.threadId, toolCallId: command.itemId };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("native heavy steps wait for memory, inherit the owner in scripts, and release only at terminal completion", async () => {
  const fixture = createFixtureLifetime();
  const root = fixture.createTempDir("branch-native-heavy-");
  vi.stubEnv("BRANCH_HEAVY_STEP_DIRECTORY", root);
  vi.stubEnv("BRANCH_HOST_HEAVY_STEP_OWNER", "");
  vi.stubEnv("BRANCH_HEAVY_STEP_BUILD_MEMORY_MB", "8");
  const memory = vi.spyOn(availableMemory, "availableMemoryBytes").mockReturnValue(1024);
  const client = createClientHarness();
  const origin = source(false);
  const waiting = vi.fn();
  origin.owner.bindTurn(client.client, command.threadId, command.turnId);
  const relay = createCodexNativeHookRelay({
    options: { enabled: true },
    events: ["pre_tool_use"],
    agentId: undefined,
    sessionId: "native-heavy",
    sessionKey: undefined,
    config: {},
    runId: "native-heavy",
    attemptTimeoutMs: 60_000,
    startupTimeoutMs: 1000,
    turnStartTimeoutMs: 1000,
    loopDetectionPreToolUseRelay: false,
    signal: origin.abort.signal,
    hostCapabilities: origin.host,
    nativeProcessAuthority: { owner: origin.owner, client: () => client.client },
    onPreToolUseFailure: () => {},
  });
  if (!relay) {
    throw new Error("Expected native heavy-step relay");
  }
  await relay.prepareInvocation();
  const config = buildCodexNativeHookRelayConfig({
    relay,
    events: ["pre_tool_use"],
    heavyStepEnvironment: origin.owner.heavyStepEnvironment,
    heavyStepTimeoutSec: 60,
  });
  const items: Record<string, unknown>[] = [];
  const unsubscribe = onAgentEvent((event) => {
    if (event.runId === "native-heavy" && typeof event.data.summary === "string") {
      items.push(event.data);
      waiting(event.data.summary);
    }
  });
  const pending = invokeNativeHookRelay({
    provider: "codex",
    relayId: relay.relayId,
    event: "pre_tool_use",
    rawPayload: {
      session_id: command.threadId,
      turn_id: command.turnId,
      tool_use_id: command.itemId,
      tool_name: "exec_command",
      tool_input: { cmd: "pnpm build" },
    },
  });
  try {
    await vi.waitFor(() =>
      expect(waiting).toHaveBeenCalledWith("Waiting for memory: 0 builds ahead"),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: "command",
        meta: "Waiting for memory: 0 builds ahead",
        phase: "update",
      }),
    );
    expect(config.shell_environment_policy).toMatchObject({
      set: origin.owner.heavyStepEnvironment,
    });
    expect(config["hooks.PreToolUse"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hooks: expect.arrayContaining([expect.objectContaining({ timeout: 60 })]),
        }),
      ]),
    );
    expect(origin.owner.commands.size).toBe(0);
    origin.owner.admit(client.client, { ...command, itemId: "light" }, assertActive);
    expect(origin.owner.commands.size).toBe(1);
    memory.mockReturnValue(16 * 1024 ** 2);
    await pending;
    expect(waiting).toHaveBeenCalledWith("Starting heavy step");
    memory.mockReturnValue(0);
    const child = await acquireHostHeavyStep("typecheck", {
      env: {
        ...process.env,
        ...origin.owner.heavyStepEnvironment,
        BRANCH_HEAVY_STEP_TYPECHECK_MEMORY_MB: "0",
      },
    });
    await child.release();
    relay.unregister();
    await relay.drain();
    origin.owner.release();
    expect(origin.released).not.toHaveBeenCalled();
    client.send({
      method: "item/completed",
      params: {
        threadId: command.threadId,
        turnId: command.turnId,
        item: { id: command.itemId, type: "commandExecution", exitCode: 0 },
      },
    });
    await vi.waitFor(() => expect(origin.released).toHaveBeenCalledOnce());
  } finally {
    origin.abort.abort();
    await pending.catch(() => {});
    unsubscribe();
    relay.unregister();
    await relay.drain();
    origin.owner.release();
    client.client.close();
    await fixture.cleanup();
  }
});

it("native heavy-step cancellation retains the host slot until exact local cleanup is confirmed", async () => {
  const fixture = createFixtureLifetime();
  const root = fixture.createTempDir("branch-native-cancel-");
  vi.stubEnv("BRANCH_HEAVY_STEP_DIRECTORY", root);
  vi.stubEnv("BRANCH_HOST_HEAVY_STEP_OWNER", "");
  vi.stubEnv("BRANCH_HEAVY_STEP_BUILD_MEMORY_MB", "0");
  const client = createClientHarness();
  const origin = source(false);
  const controller = new AbortController();
  const waiting = vi.fn();
  origin.owner.bindTurn(client.client, command.threadId, command.turnId);
  await origin.owner.admitHeavyStep(
    client.client,
    command,
    assertActive,
    "pnpm build",
    undefined,
    vi.fn(),
  );
  origin.owner.release();
  origin.abort.abort();
  const pending = acquireHostHeavyStep("build", { signal: controller.signal, onWait: waiting });
  try {
    await vi.waitFor(() =>
      expect(waiting).toHaveBeenCalledWith("Waiting for build slot: 1 build ahead"),
    );
    expect(origin.released).not.toHaveBeenCalled();
    origin.owner.settleTerminatedLocalTurn(client.client, command.threadId, "different-turn");
    expect(origin.released).not.toHaveBeenCalled();
    origin.owner.settleTerminatedLocalTurn(client.client, command.threadId, command.turnId);
    await (await pending).release();
    await vi.waitFor(() => expect(origin.released).toHaveBeenCalledOnce());
  } finally {
    controller.abort();
    origin.owner.settleTerminatedLocalTurn(client.client, command.threadId, command.turnId);
    await pending.then(
      (handle) => handle.release(),
      () => {},
    );
    client.client.close();
    await fixture.cleanup();
  }
});

it("native heavy steps retain background custody through running receipts and unavailable inventory", async () => {
  const fixture = createFixtureLifetime();
  vi.stubEnv("BRANCH_HEAVY_STEP_DIRECTORY", fixture.createTempDir("branch-native-background-"));
  vi.stubEnv("BRANCH_HOST_HEAVY_STEP_OWNER", "");
  vi.stubEnv("BRANCH_HEAVY_STEP_BUILD_MEMORY_MB", "0");
  const client = createClientHarness();
  const origin = source(false);
  const controller = new AbortController();
  const waiting = vi.fn();
  origin.owner.bindTurn(client.client, command.threadId, command.turnId);
  await origin.owner.admitHeavyStep(
    client.client,
    command,
    assertActive,
    "pnpm build",
    undefined,
    waiting,
  );
  const item = {
    id: command.itemId,
    type: "commandExecution",
    processId: "background-build",
    status: "inProgress",
    exitCode: null,
  };
  client.send({ method: "item/completed", params: { ...command, item } });
  client.send({
    method: "turn/completed",
    params: {
      threadId: command.threadId,
      turn: { id: command.turnId, status: "completed", items: [item] },
    },
  });
  const pendingCommands = new Map([[command.itemId, "background-build"]]);
  const retain = origin.owner.prepareBackgroundCommands(client.client, command, pendingCommands);
  retain(new Map(), false);
  origin.owner.release();
  const pending = acquireHostHeavyStep("build", { signal: controller.signal, onWait: waiting });
  try {
    await vi.waitFor(() =>
      expect(waiting).toHaveBeenCalledWith("Waiting for build slot: 1 build ahead"),
    );
    expect(origin.released).not.toHaveBeenCalled();
    const confirm = origin.owner.prepareBackgroundCommands(client.client, command, pendingCommands);
    confirm(pendingCommands);
    client.send({
      method: "item/completed",
      params: {
        ...command,
        item: { ...item, processId: "other-process", status: "completed", exitCode: 0 },
      },
    });
    expect(origin.released).not.toHaveBeenCalled();
    client.send({
      method: "item/completed",
      params: { ...command, item: { ...item, status: "completed", exitCode: 0 } },
    });
    await (await pending).release();
    await vi.waitFor(() => expect(origin.released).toHaveBeenCalledOnce());
  } finally {
    controller.abort();
    origin.owner.settleTerminatedLocalTurn(client.client, command.threadId, command.turnId);
    origin.owner.release();
    await pending.then(
      (handle) => handle.release(),
      () => {},
    );
    await vi.waitFor(() => expect(origin.released).toHaveBeenCalledOnce());
    client.client.close();
    await fixture.cleanup();
  }
});

describe("native process custody", () => {
  it("rechecks foreground permission before a pending spawn without closing background custody", () => {
    const client = createClientHarness();
    const origin = source();
    let active = true;
    origin.owner.bindTurn(client.client, command.threadId, command.turnId);
    origin.owner.admit(client.client, command, () => {
      if (!active) {
        throw new Error("foreground admission closed");
      }
    });
    const process = getCodexNativeProcessClient(client.client).claim(metadata, async () => {});
    try {
      active = false;
      expect(() => process.assertAdmission()).toThrow("foreground admission closed");
      expect(() => process.assertCurrent()).not.toThrow();
    } finally {
      process.settle();
      origin.owner.release();
      client.client.close();
    }
  });

  it("fences a stale or unadmitted turn before accepting a native command", () => {
    const client = createClientHarness();
    const origin = source();
    try {
      expect(() => origin.owner.admit(client.client, command, assertActive)).toThrow(
        "admitted turn",
      );
      origin.owner.bindTurn(client.client, command.threadId, command.turnId);
      expect(() =>
        origin.owner.admit(client.client, { ...command, turnId: "older" }, assertActive),
      ).toThrow("admitted turn");
      expect(() =>
        getCodexNativeProcessClient(client.client).claim(metadata, async () => {}),
      ).toThrow("no admitted native command");
    } finally {
      origin.owner.release();
      client.client.close();
    }
  });

  it("keeps revoked cleanup attached to its concrete resource across client identity reuse", async () => {
    const oldClient = createClientHarness();
    const replacement = createClientHarness();
    const oldSource = source();
    const newSource = source();
    const stopOld = vi.fn(async () => {});
    const stopNew = vi.fn(async () => {});
    oldSource.owner.bindTurn(oldClient.client, command.threadId, command.turnId);
    oldSource.owner.admit(oldClient.client, command, assertActive);
    const oldProcess = getCodexNativeProcessClient(oldClient.client).claim(metadata, stopOld);
    newSource.owner.bindTurn(replacement.client, command.threadId, command.turnId);
    newSource.owner.admit(replacement.client, command, assertActive);
    const newProcess = getCodexNativeProcessClient(replacement.client).claim(metadata, stopNew);
    try {
      oldSource.owner.release();
      expect(oldSource.released).not.toHaveBeenCalled();
      oldSource.abort.abort();
      await vi.waitFor(() => expect(stopOld).toHaveBeenCalledOnce());
      expect(stopNew).not.toHaveBeenCalled();
      expect(() => oldProcess.assertCurrent()).toThrow();
      expect(() => newProcess.assertCurrent()).not.toThrow();
      oldProcess.settle();
      expect(oldSource.released).toHaveBeenCalledOnce();
    } finally {
      oldProcess.settle();
      newProcess.settle();
      oldSource.owner.release();
      newSource.owner.release();
      oldClient.client.close();
      replacement.client.close();
    }
  });

  it("ignores old terminal receipts after an item identity is reused by another turn", () => {
    const client = createClientHarness();
    const earlier = source();
    const later = source();
    earlier.owner.bindTurn(client.client, command.threadId, command.turnId);
    earlier.owner.admit(client.client, command, assertActive);
    const earlierProcess = getCodexNativeProcessClient(client.client).claim(
      metadata,
      async () => {},
    );
    earlier.owner.release();
    earlierProcess.settle();
    later.owner.bindTurn(client.client, command.threadId, "successor");
    later.owner.admit(client.client, { ...command, turnId: "successor" }, assertActive);
    try {
      client.send({
        method: "item/completed",
        params: {
          threadId: command.threadId,
          turnId: command.turnId,
          item: { id: command.itemId, type: "commandExecution" },
        },
      });
      client.send({
        method: "turn/completed",
        params: {
          threadId: command.threadId,
          turn: { id: command.turnId, status: "completed", items: [] },
        },
      });
      const current = getCodexNativeProcessClient(client.client).claim(metadata, async () => {});
      expect(() => current.assertAdmission()).not.toThrow();
      current.settle();
    } finally {
      earlier.owner.release();
      later.owner.release();
      client.client.close();
    }
  });

  it("reports failed background settlement and refuses to replace its unsettled command", async () => {
    const client = createClientHarness();
    const origin = source();
    const successor = source();
    origin.owner.bindTurn(client.client, command.threadId, command.turnId);
    origin.owner.admit(client.client, command, assertActive);
    const process = getCodexNativeProcessClient(client.client).claim(metadata, async () => {
      throw new Error("fixture backend settlement failed");
    });
    try {
      origin.owner.release();
      origin.abort.abort();
      await vi.waitFor(() => expect(origin.failed).toHaveBeenCalledOnce());
      expect(origin.failed.mock.calls[0]?.[0]).toMatchObject({
        message: expect.stringContaining("background work remains unsettled"),
        errors: [expect.objectContaining({ message: "fixture backend settlement failed" })],
      });
      expect(origin.released).not.toHaveBeenCalled();
      successor.owner.bindTurn(client.client, command.threadId, "successor");
      expect(() =>
        successor.owner.admit(client.client, { ...command, turnId: "successor" }, assertActive),
      ).toThrow("unsettled native command identity");
    } finally {
      process.settle();
      origin.owner.release();
      successor.owner.release();
      client.client.close();
    }
  });
});
