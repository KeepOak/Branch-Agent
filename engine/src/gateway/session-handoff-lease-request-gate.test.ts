import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveSessionHandoffLeaseDir,
  writeSessionHandoffLease,
} from "../process/session-handoff-lease-files.js";
import {
  countSessionHandoffLeaseWaiters,
  refreshSessionHandoffLeases,
  resetSessionHandoffLeaseGateForTest,
} from "../process/session-handoff-lease-gate.js";
import { getFileLockProcessStartTime } from "../shared/pid-alive.js";
import { handleGatewayRequest } from "./server-methods.js";
import {
  findSessionHandoffLeasedLanes,
  isSessionHandoffGatedMethod,
  waitForSessionHandoffLeasesBeforeRequest,
} from "./session-handoff-lease-request-gate.js";

let stateDir: string;
let previousStateDir: string | undefined;

/** A lease held by the previous engine: a live process other than this one (the test runner's parent). */
function leaseFromPreviousEngine(lane: string): string {
  const { file, lease } = writeSessionHandoffLease(resolveSessionHandoffLeaseDir(), lane);
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...lease,
      pid: process.ppid,
      startTime: getFileLockProcessStartTime(process.ppid),
    }),
  );
  refreshSessionHandoffLeases();
  return file;
}

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-lease-request-gate-"));
  previousStateDir = process.env.BRANCH_STATE_DIR;
  process.env.BRANCH_STATE_DIR = stateDir;
  resetSessionHandoffLeaseGateForTest();
});

afterEach(() => {
  resetSessionHandoffLeaseGateForTest();
  if (previousStateDir === undefined) delete process.env.BRANCH_STATE_DIR;
  else process.env.BRANCH_STATE_DIR = previousStateDir;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("session handoff lease request gate: which requests", () => {
  it("gates session writes from the shared session method policy, and never reads", () => {
    for (const method of [
      "chat.send",
      "chat.inject",
      "agent",
      "sessions.patch",
      "sessions.patchMany",
      "sessions.reset",
      "sessions.delete",
      "sessions.compact",
      "sessions.rewind",
      "sessions.move",
      "sessions.files.set",
      "sessions.goal.update",
      "sessions.companion.reset",
    ]) {
      expect(isSessionHandoffGatedMethod(method), method).toBe(true);
    }
    for (const method of [
      "sessions.messages.subscribe",
      "sessions.get",
      "sessions.list",
      "chat.history",
      "sessions.companion.ask",
      "progressCard.get",
      "chat.abort",
      "sessions.abort",
      "sessions.processes.stop",
      "health",
    ]) {
      expect(isSessionHandoffGatedMethod(method), method).toBe(false);
    }
  });

  it("matches a session by stored key, alias, agent-scoped alias, key lists and id; never another session", () => {
    const leased = ["session:agent:main:main", "session:agent:main:work", "session:3f2a-id"];
    expect(
      findSessionHandoffLeasedLanes("sessions.patch", { key: "agent:main:work" }, leased),
    ).toEqual(["session:agent:main:work"]);
    expect(findSessionHandoffLeasedLanes("chat.send", { sessionKey: "main" }, leased)).toEqual([
      "session:agent:main:main",
    ]);
    expect(
      findSessionHandoffLeasedLanes("chat.send", { sessionKey: "work", agentId: "main" }, leased),
    ).toEqual(["session:agent:main:work"]);
    expect(
      findSessionHandoffLeasedLanes(
        "sessions.patchMany",
        { keys: ["agent:main:other", "agent:main:main"] },
        leased,
      ),
    ).toEqual(["session:agent:main:main"]);
    expect(
      findSessionHandoffLeasedLanes("sessions.recover", { key: "x", sessionId: "3f2a-id" }, leased),
    ).toEqual(["session:3f2a-id"]);
    expect(
      findSessionHandoffLeasedLanes("sessions.patch", { key: "agent:main:other" }, leased),
    ).toEqual([]);
    expect(
      findSessionHandoffLeasedLanes(
        "sessions.messages.subscribe",
        { key: "agent:main:main" },
        leased,
      ),
    ).toEqual([]);
  });

  it("waits on every held session for a write that names none, and never for a new session", () => {
    const leased = ["session:agent:main:main", "session:agent:main:work"];
    expect(findSessionHandoffLeasedLanes("agent", { message: "hi" }, leased)).toEqual(leased);
    expect(
      findSessionHandoffLeasedLanes("sessions.create", { key: "agent:main:new" }, leased),
    ).toEqual([]);
    expect(
      findSessionHandoffLeasedLanes(
        "sessions.create",
        { key: "agent:main:child", parentSessionKey: "agent:main:work" },
        leased,
      ),
    ).toEqual(["session:agent:main:work"]);
    expect(
      findSessionHandoffLeasedLanes("chat.abort", { sessionKey: "agent:main:main" }, leased),
    ).toEqual([]);
  });
});

describe("session handoff lease request gate: waiting", () => {
  it("runs a write to any other session at once, and parks a write to the held one until it is released", async () => {
    const file = leaseFromPreviousEngine("session:agent:main:held");
    expect(
      waitForSessionHandoffLeasesBeforeRequest({
        method: "sessions.patch",
        params: { key: "agent:main:free" },
      }),
    ).toBeUndefined();
    const parked = waitForSessionHandoffLeasesBeforeRequest({
      method: "sessions.patch",
      params: { key: "agent:main:held" },
    });
    expect(parked).toBeDefined();
    // A parked request counts as queued work for that session.
    expect(countSessionHandoffLeaseWaiters("session:agent:main:held")).toBe(1);
    fs.unlinkSync(file);
    await expect(parked).resolves.toEqual({ kind: "run" });
    expect(countSessionHandoffLeaseWaiters("session:agent:main:held")).toBe(0);
  });

  it("refuses as retryable once the bounded wait runs out, so a write the caller was told failed never runs", async () => {
    leaseFromPreviousEngine("session:agent:main:held");
    const waited = await waitForSessionHandoffLeasesBeforeRequest({
      method: "sessions.reset",
      params: { key: "agent:main:held" },
      maxWaitMs: 50,
    });
    expect(waited).toEqual({
      kind: "refused",
      error: expect.objectContaining({
        code: "UNAVAILABLE",
        retryable: true,
        retryAfterMs: 5_000,
        details: {
          reason: "session-handoff-lease",
          method: "sessions.reset",
          lane: "session:agent:main:held",
        },
      }),
    });
    expect(countSessionHandoffLeaseWaiters("session:agent:main:held")).toBe(0);
  });

  it("stops waiting without an answer when the caller goes away, and refuses on shutdown", async () => {
    leaseFromPreviousEngine("session:agent:main:held");
    const caller = new AbortController();
    const gone = waitForSessionHandoffLeasesBeforeRequest({
      method: "sessions.delete",
      params: { key: "agent:main:held" },
      signal: caller.signal,
    });
    caller.abort();
    await expect(gone).resolves.toEqual({ kind: "aborted" });

    const shutdown = new AbortController();
    const closing = waitForSessionHandoffLeasesBeforeRequest({
      method: "sessions.delete",
      params: { key: "agent:main:held" },
      shutdownSignal: shutdown.signal,
    });
    shutdown.abort();
    await expect(closing).resolves.toMatchObject({
      kind: "refused",
      error: { code: "UNAVAILABLE", message: expect.stringContaining("shutdown") },
    });
  });
});

describe("session handoff lease request gate: gateway dispatch", () => {
  const dispatch = (method: string, params: unknown, maxWaitMs?: number) => {
    const respond = vi.fn();
    const handler = vi.fn(async () => {});
    const done = handleGatewayRequest({
      req: { type: "req", id: "lease-gate", method, params },
      respond,
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
      extraHandlers: { [method]: handler },
      sessionHandoffLeaseMaxWaitMs: maxWaitMs,
    });
    return { respond, handler, done };
  };

  it("answers a session RPC on a held session with the retryable lease refusal, before anything else runs", async () => {
    leaseFromPreviousEngine("session:agent:main:held");
    const { respond, handler, done } = dispatch("sessions.patch", { key: "agent:main:held" }, 50);
    await done;
    expect(handler).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        retryable: true,
        details: expect.objectContaining({ reason: "session-handoff-lease" }),
      }),
    );
  });

  it("lets the RPC go on through authorization once the previous engine released the session", async () => {
    const file = leaseFromPreviousEngine("session:agent:main:held");
    const { respond, done } = dispatch("sessions.patch", { key: "agent:main:held" }, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(respond).not.toHaveBeenCalled();
    fs.unlinkSync(file);
    // Past the gate, this bare test context fails authorization one way or another; it is no lease refusal.
    await done.catch(() => {});
    for (const call of respond.mock.calls) {
      expect(call[2]?.details?.reason).not.toBe("session-handoff-lease");
    }
  });
});
