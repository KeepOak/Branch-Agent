import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { markStartupOrphanedMainSessionsForRecovery } from "../agents/main-session-recovery/main-session-restart-recovery-marking.js";
import { loadSessionEntry, replaceSessionEntry } from "../config/sessions/session-accessor.js";
import { acquireGatewayLock } from "../infra/gateway-lock.js";
import {
  resolveSessionHandoffLeaseDir,
  SESSION_HANDOFF_LEASE_MAX_AGE_MS,
  writeSessionHandoffLease,
} from "../process/session-handoff-lease-files.js";
import {
  pollSessionHandoffLeasesForTest,
  refreshSessionHandoffLeases,
  resetSessionHandoffLeaseGateForTest,
} from "../process/session-handoff-lease-gate.js";
import { getFileLockProcessStartTime } from "../shared/pid-alive.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { getFreePort } from "../test-utils/ports.js";
import { runStartupSessionMigration } from "./server-startup-session-migration.js";
import { startSessionHandoffLeaseOrphanRecovery } from "./session-handoff-lease-orphan-recovery.js";

const children: ChildProcess[] = [];
const watchers: Array<{ stop: () => void }> = [];

afterEach(async () => {
  for (const watcher of watchers.splice(0)) {
    watcher.stop();
  }
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise<void>((resolve) => {
        child.once("exit", () => {
          resolve();
        });
      });
    }
  }
  vi.restoreAllMocks();
  resetSessionHandoffLeaseGateForTest();
});

async function livePredecessor(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  children.push(child);
  await new Promise<void>((resolve) => {
    child.once("spawn", () => {
      resolve();
    });
  });
  return child;
}

function publishPredecessorLease(sessionKey: string, pid: number, acquiredAt = Date.now()): string {
  const { file, lease } = writeSessionHandoffLease(
    resolveSessionHandoffLeaseDir(),
    `session:${sessionKey}`,
  );
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...lease,
      pid,
      startTime: getFileLockProcessStartTime(pid),
      acquiredAt,
    }),
  );
  return file;
}

const runningEntry = {
  sessionId: "predecessor-session",
  updatedAt: 1,
  startedAt: 1,
  status: "running" as const,
  lifecycleRunId: "predecessor-run",
  activeWriterRunId: "predecessor-run",
  abortedLastRun: false,
};

async function waitForAborted(sessionKey: string): Promise<void> {
  const scope = { agentId: "main", sessionKey };
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    if (loadSessionEntry(scope)?.abortedLastRun === true) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
  throw new Error(`timed out waiting for ${sessionKey} to be recovered`);
}

it("recovers a predecessor-leased conversation after the holder dies without a second startup scan", async () => {
  await withBranchTestState({ label: "handoff-lease-death" }, async (state) => {
    const crashed = { agentId: "main", sessionKey: "agent:main:handoff-crash" };
    const finishing = { agentId: "main", sessionKey: "agent:main:handoff-live" };
    await replaceSessionEntry(crashed, runningEntry);
    await replaceSessionEntry(finishing, {
      ...runningEntry,
      sessionId: "still-finishing-session",
    });
    const holder = await livePredecessor();
    publishPredecessorLease(crashed.sessionKey, holder.pid!);
    publishPredecessorLease(finishing.sessionKey, process.ppid);
    refreshSessionHandoffLeases();
    const beforeCrash = loadSessionEntry(crashed);
    const beforeLive = loadSessionEntry(finishing);
    await expect(
      markStartupOrphanedMainSessionsForRecovery({ stateDir: state.stateDir }),
    ).resolves.toEqual({ marked: 0, skipped: 0 });
    expect(loadSessionEntry(crashed)).toEqual(beforeCrash);
    expect(loadSessionEntry(finishing)).toEqual(beforeLive);

    watchers.push(startSessionHandoffLeaseOrphanRecovery({ stateDir: state.stateDir }));
    holder.kill();
    await new Promise<void>((resolve) => {
      holder.once("exit", () => {
        resolve();
      });
    });
    pollSessionHandoffLeasesForTest();
    await waitForAborted(crashed.sessionKey);
    expect(loadSessionEntry(finishing)).toEqual(beforeLive);
  });
});

it("recovers a predecessor-leased conversation after its handoff lease expires", async () => {
  await withBranchTestState({ label: "handoff-lease-expiry" }, async (state) => {
    const scope = { agentId: "main", sessionKey: "agent:main:handoff-expired" };
    await replaceSessionEntry(scope, { ...runningEntry, sessionId: "expired-lease-session" });
    const holder = await livePredecessor();
    publishPredecessorLease(scope.sessionKey, holder.pid!);
    refreshSessionHandoffLeases();
    const before = loadSessionEntry(scope);
    await expect(
      markStartupOrphanedMainSessionsForRecovery({ stateDir: state.stateDir }),
    ).resolves.toEqual({ marked: 0, skipped: 0 });
    expect(loadSessionEntry(scope)).toEqual(before);

    watchers.push(startSessionHandoffLeaseOrphanRecovery({ stateDir: state.stateDir }));
    const now = Date.now();
    const clock = vi
      .spyOn(Date, "now")
      .mockImplementation(() => now + SESSION_HANDOFF_LEASE_MAX_AGE_MS + 1);
    pollSessionHandoffLeasesForTest();
    clock.mockRestore();
    await waitForAborted(scope.sessionKey);
  });
});

it("recovers a leased subagent after the predecessor dies without a second startup migration", async () => {
  await withBranchTestState({ label: "handoff-subagent-death" }, async (state) => {
    const cfg = { agents: { entries: { main: {} } } };
    await state.writeConfig(cfg);
    const scope = { agentId: "main", sessionKey: "agent:main:subagent:handoff-crash" };
    await replaceSessionEntry(scope, {
      sessionId: "predecessor-subagent",
      lifecycleRevision: "predecessor-generation",
      startedAt: 1,
      updatedAt: 1,
      status: "running",
      abortedLastRun: false,
    });
    const before = loadSessionEntry(scope);
    const holder = await livePredecessor();
    publishPredecessorLease(scope.sessionKey, holder.pid!);
    refreshSessionHandoffLeases();
    const lock = await acquireGatewayLock({
      allowInTests: true,
      port: await getFreePort(),
      listenerMode: "foreground",
    });
    if (!lock) {
      throw new Error("expected isolated Gateway ownership");
    }
    try {
      await lock.run(async () => {
        const log = { info: vi.fn(), warn: vi.fn() };
        watchers.push(
          startSessionHandoffLeaseOrphanRecovery({
            cfg,
            stateDir: state.stateDir,
            log,
          }),
        );
        await runStartupSessionMigration({ cfg, log });
        expect(loadSessionEntry(scope)).toEqual(before);
        holder.kill();
        await new Promise<void>((resolve) => {
          holder.once("exit", () => {
            resolve();
          });
        });
        pollSessionHandoffLeasesForTest();
        await waitForAborted(scope.sessionKey);
        expect(loadSessionEntry(scope)).toMatchObject({
          status: "interrupted",
          abortedLastRun: true,
        });
      });
    } finally {
      await lock.release();
    }
  });
});

it("recovers a predecessor death that settles between the startup scan and watcher registration", async () => {
  await withBranchTestState({ label: "handoff-lease-gap-death" }, async (state) => {
    const crashed = { agentId: "main", sessionKey: "agent:main:handoff-gap" };
    await replaceSessionEntry(crashed, { ...runningEntry, sessionId: "gap-death-session" });
    const holder = await livePredecessor();
    publishPredecessorLease(crashed.sessionKey, holder.pid!);
    refreshSessionHandoffLeases();
    const beforeCrash = loadSessionEntry(crashed);
    await expect(
      markStartupOrphanedMainSessionsForRecovery({ stateDir: state.stateDir }),
    ).resolves.toEqual({ marked: 0, skipped: 0 });
    expect(loadSessionEntry(crashed)).toEqual(beforeCrash);

    holder.kill();
    await new Promise<void>((resolve) => {
      holder.once("exit", () => {
        resolve();
      });
    });
    pollSessionHandoffLeasesForTest();
    expect(loadSessionEntry(crashed)).toEqual(beforeCrash);

    watchers.push(startSessionHandoffLeaseOrphanRecovery({ stateDir: state.stateDir }));
    await waitForAborted(crashed.sessionKey);
  });
});

it("leaves a successor-owned running conversation alone when another predecessor lane is released", async () => {
  await withBranchTestState({ label: "handoff-lease-successor-owned" }, async (state) => {
    const predecessor = { agentId: "main", sessionKey: "agent:main:handoff-released" };
    await replaceSessionEntry(predecessor, runningEntry);
    const holder = await livePredecessor();
    publishPredecessorLease(predecessor.sessionKey, holder.pid!);
    refreshSessionHandoffLeases();
    await expect(
      markStartupOrphanedMainSessionsForRecovery({ stateDir: state.stateDir }),
    ).resolves.toEqual({ marked: 0, skipped: 0 });

    watchers.push(startSessionHandoffLeaseOrphanRecovery({ stateDir: state.stateDir }));

    const successorOwned = { agentId: "main", sessionKey: "agent:main:successor-inflight" };
    await replaceSessionEntry(successorOwned, {
      ...runningEntry,
      sessionId: "successor-inflight-session",
      lifecycleRunId: "successor-run",
      activeWriterRunId: "successor-run",
    });
    const beforeSuccessor = loadSessionEntry(successorOwned);

    holder.kill();
    await new Promise<void>((resolve) => {
      holder.once("exit", () => {
        resolve();
      });
    });
    pollSessionHandoffLeasesForTest();
    await waitForAborted(predecessor.sessionKey);
    expect(loadSessionEntry(successorOwned)).toEqual(beforeSuccessor);
  });
});
