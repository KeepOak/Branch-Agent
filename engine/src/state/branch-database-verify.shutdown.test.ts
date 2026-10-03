import { AsyncLocalStorage } from "node:async_hooks";
import { ChildProcess } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferredCore } from "../shared/deferred.js";
import type * as VerifierImplementation from "./branch-database-verify.impl.js";
import {
  requestBranchAgentDatabaseQuickCheck,
  startBranchDatabaseIntegrityVerifier,
} from "./branch-database-verify.js";
import type { BranchDatabaseVerifyResult } from "./branch-database-verify.worker.js";

const mocks = vi.hoisted(() => ({
  runDatabaseVerifyWorker: vi.fn<typeof VerifierImplementation.runDatabaseVerifyWorker>(),
  terminateDatabaseVerifyWorker:
    vi.fn<typeof VerifierImplementation.terminateDatabaseVerifyWorker>(),
  applyBranchDatabaseVerificationResults:
    vi.fn<typeof VerifierImplementation.applyBranchDatabaseVerificationResults>(),
}));

vi.mock("./branch-database-verify.impl.js", () => ({
  ...mocks,
}));

describe("database verifier shutdown", () => {
  beforeEach(async () => {
    await import("./branch-database-verify.impl.js");
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.terminateDatabaseVerifyWorker.mockResolvedValue(undefined);
    mocks.applyBranchDatabaseVerificationResults.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the Gateway verifier without periodic full database scans", async () => {
    const env = { BRANCH_STATE_DIR: "/synthetic/idle" };
    mocks.runDatabaseVerifyWorker.mockResolvedValue([]);
    const verifier = startBranchDatabaseIntegrityVerifier({ env });
    try {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 2 * 24 * 60 * 60_000);
      expect(mocks.runDatabaseVerifyWorker).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await verifier.stop();
    }
  });

  it("waits for listening startup, then checks both queued and late cached opens", async () => {
    const env = { BRANCH_STATE_DIR: "/synthetic/queued" };
    const firstPath = path.resolve("/synthetic/first.sqlite");
    const latePath = path.resolve("/synthetic/late.sqlite");
    mocks.runDatabaseVerifyWorker.mockResolvedValue([]);
    requestBranchAgentDatabaseQuickCheck({ env, path: firstPath });
    requestBranchAgentDatabaseQuickCheck({ env, path: firstPath });
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.runDatabaseVerifyWorker).not.toHaveBeenCalled();

    const verifier = startBranchDatabaseIntegrityVerifier({ env });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.runDatabaseVerifyWorker.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({ kind: "agent", path: firstPath, check: "quick" }),
      ]);
      requestBranchAgentDatabaseQuickCheck({ env, path: latePath });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.runDatabaseVerifyWorker.mock.calls[1]?.[0]).toEqual([
        expect.objectContaining({ kind: "agent", path: latePath, check: "quick" }),
      ]);
      expect(mocks.runDatabaseVerifyWorker).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await verifier.stop();
    }
  });

  it("discards final-stop work without clearing a replacement's queued checks during drainage", async () => {
    const env = { BRANCH_STATE_DIR: "/synthetic/serial" };
    const results = createDeferredCore<BranchDatabaseVerifyResult[]>();
    mocks.runDatabaseVerifyWorker.mockReturnValueOnce(results.promise).mockResolvedValue([]);
    requestBranchAgentDatabaseQuickCheck({ env, path: "/synthetic/first.sqlite" });
    const verifier = startBranchDatabaseIntegrityVerifier({ env });
    await vi.advanceTimersByTimeAsync(0);
    requestBranchAgentDatabaseQuickCheck({ env, path: "/synthetic/late.sqlite" });
    const stopping = verifier.stop();
    const replacement = startBranchDatabaseIntegrityVerifier({ env });
    const replacementPath = path.resolve("/synthetic/replacement.sqlite");
    try {
      requestBranchAgentDatabaseQuickCheck({ env, path: replacementPath });
      await vi.advanceTimersByTimeAsync(10);
      expect(mocks.runDatabaseVerifyWorker).toHaveBeenCalledOnce();
      results.resolve([]);
      await stopping;
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.runDatabaseVerifyWorker).toHaveBeenCalledTimes(2);
      expect(mocks.runDatabaseVerifyWorker.mock.calls[1]?.[0]).toEqual([
        expect.objectContaining({ path: replacementPath, check: "quick" }),
      ]);
      expect(mocks.applyBranchDatabaseVerificationResults).toHaveBeenCalledOnce();
    } finally {
      results.resolve([]);
      await Promise.all([verifier.stop(), replacement.stop()]);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["active", "standby"] as const)(
    "serializes same-root checks in the surviving Gateway context after %s stop",
    async (retiring) => {
      const env = { BRANCH_STATE_DIR: `/synthetic/handoff-${retiring}` };
      const context = new AsyncLocalStorage<string>();
      const workerContexts: Array<string | undefined> = [];
      const applicationContexts: Array<string | undefined> = [];
      const results = createDeferredCore<BranchDatabaseVerifyResult[]>();
      const child = new ChildProcess();
      mocks.runDatabaseVerifyWorker.mockImplementation((_targets, options) => {
        workerContexts.push(context.getStore());
        if (workerContexts.length === 1) {
          options?.onWorker?.(child);
          return results.promise.then((value) => {
            options?.onWorker?.(undefined);
            return value;
          });
        }
        return Promise.resolve([]);
      });
      mocks.applyBranchDatabaseVerificationResults.mockImplementation(async () => {
        applicationContexts.push(context.getStore());
      });
      const first = context.run("first", () => startBranchDatabaseIntegrityVerifier({ env }));
      const second = context.run("second", () => startBranchDatabaseIntegrityVerifier({ env }));
      const firstPath = path.resolve("/synthetic/first.sqlite");
      const latePath = path.resolve("/synthetic/late.sqlite");
      try {
        context.run("publisher", () =>
          requestBranchAgentDatabaseQuickCheck({ env, path: firstPath }),
        );
        await vi.advanceTimersByTimeAsync(0);
        requestBranchAgentDatabaseQuickCheck({ env, path: latePath });
        requestBranchAgentDatabaseQuickCheck({ env, path: latePath });
        let stopped = false;
        const stopping = (retiring === "active" ? first : second).stop().then(() => {
          stopped = true;
        });
        await vi.advanceTimersByTimeAsync(10);
        expect(stopped).toBe(retiring === "standby");
        expect(mocks.runDatabaseVerifyWorker).toHaveBeenCalledOnce();
        expect(mocks.terminateDatabaseVerifyWorker).toHaveBeenCalledTimes(
          retiring === "active" ? 1 : 0,
        );
        results.resolve([]);
        await stopping;
        await vi.advanceTimersByTimeAsync(1);
        expect(workerContexts).toEqual(["first", retiring === "active" ? "second" : "first"]);
        expect(applicationContexts).toEqual(
          retiring === "active" ? ["second"] : ["first", "first"],
        );
        expect(
          mocks.runDatabaseVerifyWorker.mock.calls[1]?.[0].map((target) => target.path).toSorted(),
        ).toEqual((retiring === "active" ? [firstPath, latePath] : [latePath]).toSorted());
      } finally {
        results.resolve([]);
        await Promise.all([first.stop(), second.stop()]);
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("shares requested paths between peers and retains the startup environment", async () => {
    const env = { BRANCH_STATE_DIR: "/synthetic/queued-peers" };
    const capturedEnv = { ...env };
    const registeredPath = path.resolve("/synthetic/registered.sqlite");
    const unregisteredPath = path.resolve("/synthetic/unregistered.sqlite");
    mocks.runDatabaseVerifyWorker.mockResolvedValue([]);
    const first = startBranchDatabaseIntegrityVerifier({ env });
    const second = startBranchDatabaseIntegrityVerifier({ env });
    try {
      requestBranchAgentDatabaseQuickCheck({ env, path: registeredPath });
      requestBranchAgentDatabaseQuickCheck({ env, path: unregisteredPath });
      env.BRANCH_STATE_DIR = "/synthetic/changed-after-start";
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.runDatabaseVerifyWorker).toHaveBeenCalledOnce();
      expect(mocks.applyBranchDatabaseVerificationResults).toHaveBeenCalledWith(
        expect.objectContaining({ env: capturedEnv }),
      );
      expect(mocks.runDatabaseVerifyWorker.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({ path: registeredPath, check: "quick" }),
        expect.objectContaining({ path: unregisteredPath, check: "quick" }),
      ]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await second.stop();
      await first.stop();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues accepting cached opens after a failed quick-check child", async () => {
    const env = { BRANCH_STATE_DIR: "/synthetic/retry" };
    mocks.runDatabaseVerifyWorker
      .mockRejectedValueOnce(new Error("synthetic child failure"))
      .mockResolvedValue([]);
    requestBranchAgentDatabaseQuickCheck({ env, path: "/synthetic/first.sqlite" });
    const verifier = startBranchDatabaseIntegrityVerifier({ env });
    try {
      await vi.advanceTimersByTimeAsync(0);
      requestBranchAgentDatabaseQuickCheck({ env, path: "/synthetic/late.sqlite" });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.runDatabaseVerifyWorker).toHaveBeenCalledTimes(2);
      expect(mocks.applyBranchDatabaseVerificationResults).toHaveBeenCalledOnce();
    } finally {
      await verifier.stop();
    }
  });

  it.each(["fulfilled", "rejected"] as const)(
    "joins %s result application after the child has exited",
    async (outcome) => {
      const application = createDeferredCore();
      const entered = createDeferredCore();
      mocks.runDatabaseVerifyWorker.mockResolvedValue([]);
      mocks.applyBranchDatabaseVerificationResults.mockImplementation(() => {
        entered.resolve();
        return application.promise;
      });
      const verifier = startBranchDatabaseIntegrityVerifier({ env: {} });
      requestBranchAgentDatabaseQuickCheck({ env: {}, path: "/synthetic/first.sqlite" });
      await vi.advanceTimersByTimeAsync(0);
      await entered.promise;
      const peer = startBranchDatabaseIntegrityVerifier({ env: {} });
      requestBranchAgentDatabaseQuickCheck({ env: {}, path: "/synthetic/late.sqlite" });
      let stopped = false;
      const stopping = verifier.stop().then(() => {
        stopped = true;
      });
      try {
        try {
          await vi.advanceTimersByTimeAsync(100);
          expect(stopped).toBe(false);
          expect(mocks.runDatabaseVerifyWorker).toHaveBeenCalledOnce();
          expect(mocks.terminateDatabaseVerifyWorker).not.toHaveBeenCalled();
        } finally {
          if (outcome === "rejected") {
            application.reject(new Error("synthetic confirmation failure"));
          } else {
            application.resolve();
          }
          await stopping;
        }
        await vi.advanceTimersByTimeAsync(1);
        expect(mocks.runDatabaseVerifyWorker).toHaveBeenCalledTimes(2);
      } finally {
        await peer.stop();
      }
      expect(stopped).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("joins the running turn after termination and skips results received during stop", async () => {
    const results = createDeferredCore<BranchDatabaseVerifyResult[]>();
    const child = new ChildProcess();
    mocks.runDatabaseVerifyWorker.mockImplementation((_targets, options) => {
      options?.onWorker?.(child);
      return results.promise;
    });
    const verifier = startBranchDatabaseIntegrityVerifier({ env: {} });
    requestBranchAgentDatabaseQuickCheck({ env: {}, path: "/synthetic/first.sqlite" });
    await vi.advanceTimersByTimeAsync(0);
    let stopped = false;
    const stopping = verifier.stop().then(() => {
      stopped = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.terminateDatabaseVerifyWorker).toHaveBeenCalledWith(child);
      expect(stopped).toBe(false);
    } finally {
      results.resolve([]);
      await stopping;
    }
    expect(mocks.applyBranchDatabaseVerificationResults).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
