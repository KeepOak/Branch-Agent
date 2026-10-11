import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  markOrphanedMainSessionForRecovery,
  markStartupOrphanedMainSessionsForRecovery,
} from "../agents/main-session-recovery/main-session-restart-recovery-marking.js";
import * as sessionAccessor from "../config/sessions/session-accessor.js";
import { loadSessionEntry, replaceSessionEntry } from "../config/sessions/session-accessor.js";
import {
  refreshSessionHandoffLeases,
  resetSessionHandoffLeaseGateForTest,
} from "../process/session-handoff-lease-gate.js";
import {
  removeSessionHandoffLease,
  resolveSessionHandoffLeaseDir,
  writeSessionHandoffLease,
} from "../process/session-handoff-lease-files.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { acquireGatewayLock } from "../infra/gateway-lock.js";
import { getFreePort } from "../test-utils/ports.js";
import { runStartupSessionMigration } from "./server-startup-session-migration.js";

afterEach(() => {
  vi.restoreAllMocks();
  resetSessionHandoffLeaseGateForTest();
});

// The test's parent is a real live foreign process. Publish its lease in the
// isolated state directory without borrowing a running Gateway's state or port.
function holdPredecessorSession(sessionKey: string): () => void {
  const { file, lease } = writeSessionHandoffLease(
    resolveSessionHandoffLeaseDir(),
    `session:${sessionKey}`,
  );
  fs.writeFileSync(file, JSON.stringify({ ...lease, pid: process.ppid, startTime: null }));
  refreshSessionHandoffLeases();
  return () => {
    removeSessionHandoffLease(file);
    resetSessionHandoffLeaseGateForTest();
  };
}

it("retains a predecessor's leased writer while recovering unrelated startup orphans", async () => {
  await withBranchTestState({ label: "startup-handoff-owner" }, async (state) => {
    const held = { agentId: "main", sessionKey: "agent:main:handoff-s" };
    const orphan = { agentId: "main", sessionKey: "agent:main:orphan" };
    const entry = {
      sessionId: "predecessor-session",
      updatedAt: 1,
      startedAt: 1,
      status: "running" as const,
      lifecycleRunId: "predecessor-run",
      activeWriterRunId: "predecessor-run",
      abortedLastRun: false,
    };
    await replaceSessionEntry(held, entry);
    await replaceSessionEntry(orphan, { ...entry, sessionId: "orphan-session" });
    const before = loadSessionEntry(held);
    const release = holdPredecessorSession(held.sessionKey);
    try {
      await expect(
        markStartupOrphanedMainSessionsForRecovery({ stateDir: state.stateDir }),
      ).resolves.toEqual({ marked: 1, skipped: 0 });
      expect(loadSessionEntry(held)).toEqual(before);
      expect(loadSessionEntry(orphan)?.abortedLastRun).toBe(true);
      await expect(
        markOrphanedMainSessionForRecovery({
          target: { ...held, storePath: path.join(state.sessionsDir(), "sessions.json") },
          expectedSessionId: entry.sessionId,
        }),
      ).resolves.toEqual({ marked: 0, skipped: 0 });
      expect(loadSessionEntry(held)).toEqual(before);
    } finally {
      release();
    }
    // A gone predecessor no longer protects an orphan from ordinary recovery.
    await expect(
      markStartupOrphanedMainSessionsForRecovery({ stateDir: state.stateDir }),
    ).resolves.toEqual({ marked: 1, skipped: 0 });
    expect(loadSessionEntry(held)?.abortedLastRun).toBe(true);
  });
});

it("rechecks a predecessor lease acquired after orphan planning before committing recovery", async () => {
  await withBranchTestState({ label: "startup-handoff-commit" }, async (state) => {
    const scope = { agentId: "main", sessionKey: "agent:main:handoff-s" };
    await replaceSessionEntry(scope, {
      sessionId: "predecessor-session",
      updatedAt: 1,
      status: "running",
      abortedLastRun: false,
    });
    const before = loadSessionEntry(scope);
    let release: (() => void) | undefined;
    const apply = sessionAccessor.applySessionEntryReplacements;
    vi.spyOn(sessionAccessor, "applySessionEntryReplacements").mockImplementationOnce((params) =>
      apply({
        ...params,
        update: async (entries) => {
          const prepared = await params.update(entries);
          release = holdPredecessorSession(scope.sessionKey);
          return prepared;
        },
      }),
    );
    try {
      const result = await markStartupOrphanedMainSessionsForRecovery({ stateDir: state.stateDir });
      expect(result.marked).toBe(0);
      expect(result.failedTargets).toHaveLength(1);
      expect(loadSessionEntry(scope)).toEqual(before);
    } finally {
      release?.();
    }
  });
});

it("retains a leased subagent writer during startup orphan reconciliation", async () => {
  await withBranchTestState({ label: "startup-subagent-handoff" }, async (state) => {
    const cfg = { agents: { entries: { main: {} } } };
    await state.writeConfig(cfg);
    const scope = { agentId: "main", sessionKey: "agent:main:subagent:handoff" };
    await replaceSessionEntry(scope, {
      sessionId: "predecessor-subagent",
      lifecycleRevision: "predecessor-generation",
      startedAt: 1,
      updatedAt: 1,
      status: "running",
      abortedLastRun: false,
    });
    const before = loadSessionEntry(scope);
    const release = holdPredecessorSession(scope.sessionKey);
    const lock = await acquireGatewayLock({
      allowInTests: true,
      port: await getFreePort(),
      listenerMode: "foreground",
    });
    if (!lock) throw new Error("expected isolated Gateway ownership");
    try {
      await lock.run(async () => {
        const log = { info: vi.fn(), warn: vi.fn() };
        await runStartupSessionMigration({ cfg, log });
        expect(loadSessionEntry(scope)).toEqual(before);
        expect(log.warn).not.toHaveBeenCalled();
        release();
        await runStartupSessionMigration({ cfg, log });
        expect(loadSessionEntry(scope)).toMatchObject({
          status: "interrupted",
          abortedLastRun: true,
        });
      });
    } finally {
      release();
      await lock.release();
    }
  });
});
