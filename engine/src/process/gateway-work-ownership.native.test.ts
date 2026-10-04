import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerChatAbortController,
  type ChatAbortControllerEntry,
} from "../gateway/chat-abort.js";
import { rotateAgentRunRegistryLifecycleGeneration } from "../infra/agent-run-registry.js";
import { beginSessionWorkAdmission } from "../sessions/session-lifecycle-admission.js";
import { createDeferredCore } from "../shared/deferred.js";
import {
  clearCommandLane,
  enqueueCommandInLane,
  getTotalQueueSize,
  resetAllLanes,
} from "./command-queue.js";
import {
  beginGatewayRootWorkAdmissionWhenOpen,
  getActiveGatewayRootWorkCount,
  resetGatewayWorkAdmission,
  runWithGatewayIndependentRootWorkAdmission,
  runWithGatewayIndependentRootWorkContinuation,
} from "./gateway-work-admission.js";
import { readSelectedRunWorkCoverage } from "./gateway-work-ownership-coverage.js";
import type { SelectedRunWorkIdentity } from "./gateway-work-ownership.js";

const sessionKey = "agent:main:direct:ownership-test";
const sessionId = "ownership-session";
const runId = "ownership-run";
let scope: string;
let controllers: Map<string, ChatAbortControllerEntry>;
const cleanup: Array<() => void> = [];

function register(id = runId, key = sessionKey, physicalId = sessionId) {
  const registration = registerChatAbortController({
    chatAbortControllers: controllers,
    runId: id,
    sessionKey: key,
    sessionId: physicalId,
    timeoutMs: 0,
    kind: "agent",
  });
  cleanup.push(registration.cleanup);
  return registration;
}
function selected(controller: AbortController): SelectedRunWorkIdentity {
  return { runId, sessionKey, sessionId, controller };
}
const zero = { rootRequests: 0, queueSize: 0, sessionAdmissions: 0 };
function coverage(identity: SelectedRunWorkIdentity) {
  return readSelectedRunWorkCoverage(identity).coveredCounts;
}
async function root() {
  const lease = await beginGatewayRootWorkAdmissionWhenOpen("test:ownership");
  cleanup.push(lease.release);
  return lease;
}
async function session(key = sessionKey, physicalId = sessionId) {
  const lease = await beginSessionWorkAdmission({
    scope,
    identities: [key, physicalId],
    assertAllowed: () => {},
  });
  cleanup.push(lease.release);
  return lease;
}

beforeEach(async () => {
  resetAllLanes();
  controllers = new Map();
  scope = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "branch-work-owner-")),
    "sessions.json",
  );
});
afterEach(async () => {
  for (const release of cleanup.splice(0).reverse()) {
    release();
  }
  for (const lane of ["test:ownership", "test:unknown", "test:other-session"]) {
    clearCommandLane(lane);
  }
  resetAllLanes();
  await fs.rm(path.dirname(scope), { recursive: true, force: true });
});

describe("host-owned selected work provenance", () => {
  it("covers actual admitted roots, retained continuations, acquired session work and both queued/running commands", async () => {
    const lease = await root();
    const finish = createDeferredCore();
    const started = createDeferredCore<SelectedRunWorkIdentity>();
    const jobs: Promise<unknown>[] = [];
    const work = lease.run(async () => {
      // Session admission exists before the canonical controller registration.
      const admission = await session();
      const registration = register();
      expect(registration.markExecutionStarted()).toBe(true);
      jobs.push(
        admission.run(async () => {
          const first = enqueueCommandInLane("test:ownership", async () => await finish.promise);
          const second = enqueueCommandInLane("test:ownership", async () => await finish.promise);
          await Promise.all([first, second]);
        }),
      );
      jobs.push(runWithGatewayIndependentRootWorkContinuation(async () => await finish.promise));
      started.resolve(selected(registration.controller));
      await finish.promise;
    });
    const identity = await started.promise;
    expect(coverage(identity)).toEqual({ rootRequests: 2, queueSize: 2, sessionAdmissions: 1 });
    expect(getTotalQueueSize()).toBe(2);
    expect(getActiveGatewayRootWorkCount()).toBe(2);
    expect(await lease.run(async () => coverage(identity).rootRequests)).toBe(1);
    finish.resolve();
    await Promise.all([work, ...jobs]);
    lease.release();
    cleanup
      .splice(0)
      .reverse()
      .forEach((release) => release());
    expect(coverage(identity)).toEqual(zero);
  });

  it("does not let public diagnostic JSON cover another independent root or command", async () => {
    const lease = await root();
    const registration = await lease.run(async () => register());
    registration.markExecutionStarted();
    const identity = selected(registration.controller);
    const finish = createDeferredCore();
    const ready = createDeferredCore();
    const unrelated = lease.run(
      async () =>
        await runWithGatewayIndependentRootWorkAdmission(async () => {
          const job = enqueueCommandInLane("test:unknown", async () => await finish.promise, {
            sessionTarget: { sessionId, sessionKey },
            taskIdentity: { taskKind: "agent", runId, sessionKey },
          });
          ready.resolve();
          await job;
        }),
    );
    await ready.promise;
    expect(getTotalQueueSize()).toBe(1);
    expect(getActiveGatewayRootWorkCount()).toBe(2);
    expect(coverage(identity)).toEqual({ ...zero, rootRequests: 1 });
    expect(coverage({ ...identity, controller: new AbortController() })).toEqual(zero);
    expect(coverage({ ...identity, sessionId: "replacement" })).toEqual(zero);
    finish.resolve();
    await unrelated;
  });

  it("narrows a different session admission and its commands even inside the selected root", async () => {
    const lease = await root();
    const finish = createDeferredCore();
    const registration = await lease.run(async () => register());
    registration.markExecutionStarted();
    const identity = selected(registration.controller);
    const jobs: Promise<unknown>[] = [];
    await lease.run(async () => {
      const other = await session("agent:main:direct:private-other", "private-other-session");
      jobs.push(
        other.run(
          async () =>
            await enqueueCommandInLane("test:other-session", async () => await finish.promise, {
              // Even matching caller hints cannot override the actual admission identities.
              sessionTarget: { sessionKey, sessionId },
              taskIdentity: { taskKind: "agent", runId, sessionKey },
            }),
        ),
      );
      jobs.push(
        other.run(
          async () =>
            await runWithGatewayIndependentRootWorkContinuation(async () => await finish.promise),
        ),
      );
    });
    expect(getTotalQueueSize()).toBe(1);
    expect(coverage(identity)).toEqual({ ...zero, rootRequests: 1 });
    finish.resolve();
    await Promise.all(jobs);
  });

  it("requires real execution and retires proof on canonical entry replacement, cleanup, abort and lifecycle rotation", async () => {
    const lease = await root();
    const registration = await lease.run(async () => register());
    const identity = selected(registration.controller);
    expect(coverage(identity)).toEqual(zero);
    registration.markExecutionStarted();
    expect(coverage(identity).rootRequests).toBe(1);
    const entry = controllers.get(runId)!;
    controllers.set(runId, { ...entry });
    expect(coverage(identity)).toEqual(zero);
    controllers.set(runId, entry);
    expect(coverage(identity).rootRequests).toBe(1);
    entry.sessionId = "retargeted-session";
    expect(coverage(identity)).toEqual(zero);
    entry.sessionId = sessionId;
    expect(coverage(identity).rootRequests).toBe(1);
    rotateAgentRunRegistryLifecycleGeneration();
    expect(coverage(identity)).toEqual(zero);
    const next = await root();
    const nextRegistration = await next.run(async () => register("next-run"));
    nextRegistration.markExecutionStarted();
    const nextIdentity = {
      ...identity,
      runId: "next-run",
      controller: nextRegistration.controller,
    };
    expect(coverage(nextIdentity).rootRequests).toBe(1);
    nextRegistration.controller.abort();
    expect(coverage(nextIdentity)).toEqual(zero);
    const last = await root();
    const lastRegistration = await last.run(async () => register("cleanup-run"));
    lastRegistration.markExecutionStarted();
    const lastIdentity = {
      ...identity,
      runId: "cleanup-run",
      controller: lastRegistration.controller,
    };
    expect(coverage(lastIdentity).rootRequests).toBe(1);
    lastRegistration.cleanup();
    expect(coverage(lastIdentity)).toEqual(zero);
  });

  it("fails closed when one root registers multiple turns or receives a duplicate run id", async () => {
    const lease = await root();
    const registration = await lease.run(async () => register());
    registration.markExecutionStarted();
    const identity = selected(registration.controller);
    const duplicateRoot = await root();
    const duplicate = await duplicateRoot.run(async () => register());
    expect(duplicate.registered).toBe(false);
    expect(coverage(identity).rootRequests).toBe(1);
    expect(coverage(selected(duplicate.controller))).toEqual(zero);
    const second = await lease.run(async () => register("other-run", "other-key", "other-session"));
    second.markExecutionStarted();
    expect(coverage(identity)).toEqual(zero);
    expect(
      coverage({
        runId: "other-run",
        sessionKey: "other-key",
        sessionId: "other-session",
        controller: second.controller,
      }),
    ).toEqual(zero);
  });

  it("retires old admitted queue and session provenance on an in-process admission reset", async () => {
    const lease = await root();
    const finish = createDeferredCore();
    const jobs: Promise<unknown>[] = [];
    const identity = await lease.run(async () => {
      const admission = await session();
      const registration = register();
      registration.markExecutionStarted();
      jobs.push(
        admission.run(
          async () =>
            await enqueueCommandInLane("test:ownership", async () => await finish.promise),
        ),
      );
      return selected(registration.controller);
    });
    expect(coverage(identity)).toEqual({ rootRequests: 1, queueSize: 1, sessionAdmissions: 1 });
    resetGatewayWorkAdmission();
    expect(coverage(identity)).toEqual(zero);
    finish.resolve();
    await Promise.all(jobs);
  });

  it("keeps ordinary unbound admitted work behavior and global totals unchanged", async () => {
    const lease = await root();
    const result = await lease.run(async () => {
      const admission = await session();
      return await admission.run(
        async () => await enqueueCommandInLane("test:ownership", async () => "ordinary-result"),
      );
    });
    expect(result).toBe("ordinary-result");
    expect(getTotalQueueSize()).toBe(0);
    expect(coverage(selected(new AbortController()))).toEqual(zero);
    expect(getActiveGatewayRootWorkCount()).toBe(1);
  });
});
