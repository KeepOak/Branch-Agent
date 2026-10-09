import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import { cleanupSessionStateForTest } from "../test-utils/session-state-cleanup.js";
import { createSubscribedSessionHarness } from "./embedded-agent-subscribe.e2e-harness.js";
import { RunJournal, withRunJournal } from "./run-journal.js";
import { makeAgentAssistantMessage } from "./test-helpers/agent-message-fixtures.js";

const roots: string[] = [];
const children = new Set<ChildProcess>();
const childErrors = new WeakMap<ChildProcess, string>();
function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-run-journal-"));
  roots.push(root);
  return root;
}
function input(root: string, runId = "run-1") {
  return {
    database: { agentId: "oak", env: { ...process.env, BRANCH_STATE_DIR: root } },
    runId,
    sessionId: "session-1",
    snapshotId: "snapshot-1",
  };
}
function rows(root: string, agentId = "oak") {
  return openBranchAgentDatabase({
    agentId,
    env: { ...process.env, BRANCH_STATE_DIR: root },
  })
    .db.prepare("SELECT * FROM run_journal ORDER BY sequence")
    .all();
}
function startEvent(toolCallId = "call-1") {
  return {
    type: "tool_execution_start" as const,
    toolName: "fixture",
    toolCallId,
    args: { value: 1 },
  };
}
function endEvent(toolCallId = "call-1") {
  return {
    type: "tool_execution_end" as const,
    toolName: "fixture",
    toolCallId,
    result: { content: [{ type: "text" as const, text: "done" }] },
    isError: false,
  };
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    children.delete(child);
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill();
  await exited;
  children.delete(child);
}
function waitMessage(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error(`Journal fixture did not report ${expected}`)),
      30_000,
    );
    const message = (value: unknown) => {
      if (value === expected) {
        finish();
      }
    };
    const exited = (code: number | null) =>
      finish(new Error(`Journal fixture exited: ${code}\n${childErrors.get(child) ?? ""}`));
    function finish(error?: Error) {
      clearTimeout(timer);
      child.off("message", message);
      child.off("exit", exited);
      child.off("error", finish);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }
    child.on("message", message);
    child.once("exit", exited);
    child.once("error", finish);
  });
}
function writer(root: string, agentId: string, mode = "concurrent") {
  const cwd = fileURLToPath(new URL("../../", import.meta.url));
  const child = spawn(
    process.execPath,
    [
      "--import",
      "./scripts/tsx.mjs",
      "src/agents/run-journal.process.test-support.ts",
      root,
      agentId,
      mode,
    ],
    { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  children.add(child);
  // Drain pipes so diagnostics cannot block a child holding a test writer.
  child.stdout?.resume();
  child.stderr?.on("data", (chunk: Buffer) => {
    childErrors.set(child, (childErrors.get(child) ?? "") + chunk.toString());
  });
  return child;
}

afterEach(async () => {
  await Promise.all([...children].map(stop));
  for (const root of roots.splice(0)) {
    await cleanupSessionStateForTest({ stateDir: root });
    closeBranchAgentDatabasesForTest(root);
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

describe("per-Trunk run journal", () => {
  it("journals subscribed model results and two tool boundaries before delivery, with the pinned snapshot", async () => {
    const root = scratch();
    await withRunJournal(input(root), async () => {
      const h = createSubscribedSessionHarness({ runId: "run-1", sessionPersistence: "detached" });
      try {
        for (const callId of ["call-1", "call-2"]) {
          const message = makeAgentAssistantMessage({
            content: [{ type: "toolCall", id: callId, name: "fixture", arguments: { value: 1 } }],
            stopReason: "toolUse",
          });
          h.emit({ type: "message_end", message });
          h.emit(startEvent(callId));
          // Read before queued presentation settles: the call is already durable.
          expect(rows(root).at(-1)?.event_type).toBe("tool_call");
          h.emit(endEvent(callId));
        }
        await h.subscription.waitForPendingEvents();
      } finally {
        h.subscription.unsubscribe();
      }
    });
    const events = rows(root);
    expect(events.map((event) => event.event_type)).toEqual([
      "run_started",
      "model_result",
      "tool_call",
      "tool_result",
      "model_result",
      "tool_call",
      "tool_result",
      "run_ended",
    ]);
    expect(events.every((event) => event.snapshot_id === "snapshot-1")).toBe(true);
    expect(new Set(events.map((event) => event.sequence)).size).toBe(events.length);
    for (const [call, result] of [
      [events[2], events[3]],
      [events[5], events[6]],
    ]) {
      expect(call?.operation_key).toBe(result?.operation_key);
      expect(call?.attempt_id).toBe(result?.attempt_id);
      expect(call?.attempt_id).toEqual(expect.any(String));
    }
  });

  it("keeps operation keys across attempts while assigning a fresh attempt id and recording state changes", () => {
    const root = scratch();
    const journal = new RunJournal(input(root));
    journal.record({ type: "agent_start" }, []);
    journal.record(startEvent(), []);
    journal.record(endEvent(), []);
    journal.record(startEvent(), []);
    journal.record(endEvent(), []);
    journal.end("completed");
    const events = rows(root);
    const calls = events.filter((event) => event.event_type === "tool_call");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.operation_key).toBe(calls[1]?.operation_key);
    expect(calls[0]?.attempt_id).not.toBe(calls[1]?.attempt_id);
    expect(events[1]?.event_type).toBe("state_changed");
  });

  it("journals nested Code Mode tool execution before its side effect and after its result", async () => {
    const root = scratch();
    await withRunJournal(input(root), async () => {
      const h = createSubscribedSessionHarness({ runId: "run-1", sessionPersistence: "detached" });
      try {
        await h.subscription.runToolLifecycle({
          toolName: "fixture",
          toolCallId: "nested-1",
          parentToolCallId: "outer-1",
          args: { value: 1 },
          execute: async (started) => {
            expect(rows(root).at(-1)?.event_type).toBe("tool_call");
            started();
            return endEvent().result;
          },
        });
        expect(rows(root).at(-1)?.event_type).toBe("tool_result");
      } finally {
        h.subscription.unsubscribe();
      }
    });
    expect(rows(root).map((row) => row.event_type)).toEqual([
      "run_started",
      "tool_call",
      "tool_result",
      "run_ended",
    ]);
  });

  it("keeps the pending call and pinned identity when compaction checkpoints an in-flight tool", () => {
    const root = scratch();
    const journal = new RunJournal(input(root));
    journal.record(startEvent(), []);
    const attemptId = rows(root).at(-1)?.attempt_id;
    journal.record(
      {
        type: "compaction_end",
        reason: "threshold",
        outcome: { status: "completed", willRetry: false, tokensBefore: 200, tokensAfter: 100 },
      },
      [],
    );
    const checkpoint = rows(root)[0];
    expect(checkpoint?.event_type).toBe("compaction_checkpoint");
    expect(JSON.parse(String(checkpoint?.payload_json))).toMatchObject({
      snapshotId: "snapshot-1",
      pendingTools: [
        [
          "call-1",
          {
            operationKey: '["run-1","call-1"]',
            attemptId,
            call: startEvent(),
          },
        ],
      ],
    });
    journal.record(endEvent(), []);
    expect(rows(root).at(-1)?.attempt_id).toBe(attemptId);
  });

  it("rolls back a failed append and never reports success after losing a durable boundary", async () => {
    const root = scratch();
    await expect(
      withRunJournal(input(root), async () => {
        const journal = new RunJournal(input(root, "failed-run"));
        const badArgs: Record<string, unknown> = {};
        badArgs.self = badArgs;
        expect(() => journal.record({ ...startEvent(), args: badArgs }, [])).toThrow(
          "This run couldn't save its progress.",
        );
        expect(() => journal.end("completed")).toThrow();
        const unmatched = new RunJournal(input(root, "unmatched-result"));
        expect(() => unmatched.record(endEvent(), [])).toThrow("without a saved start");
        expect(() => unmatched.end("completed")).toThrow("without a saved start");
        throw new Error("run failed");
      }),
    ).rejects.toThrow("run failed");
    const failed = rows(root).filter((row) => row.run_id === "failed-run");
    expect(failed.map((row) => row.event_type)).toEqual(["run_started"]);
    expect(JSON.parse(String(rows(root).at(-1)?.payload_json))).toEqual({ status: "failed" });
  });

  it("allows four Trunks to hold their journal writers at once without a shared lock", async () => {
    const root = scratch();
    const writers: ChildProcess[] = [];
    // Cold shared-registry bootstrap is outside the hot journal writer proof.
    for (const agentId of ["oak", "elm", "birch", "ash"]) {
      const child = writer(root, agentId);
      writers.push(child);
      await waitMessage(child, "ready");
    }
    const locked = writers.map((child) => waitMessage(child, "locked"));
    writers.forEach((child) => child.send("hold"));
    // All four must report an active BEGIN IMMEDIATE before any is released.
    await Promise.all(locked);
    const exited = writers.map(
      (child) =>
        new Promise<void>((resolve, reject) => {
          child.once("exit", (code) =>
            code === 0 ? resolve() : reject(new Error(`writer exit ${code}`)),
          );
        }),
    );
    writers.forEach((child) => child.send("release"));
    await Promise.all(exited);
    for (const agentId of ["oak", "elm", "birch", "ash"]) {
      expect(rows(root, agentId).map((row) => row.event_type)).toEqual([
        "run_started",
        "tool_call",
        "tool_result",
        "run_ended",
      ]);
    }
  }, 60_000);

  it("recovers after a process dies mid-tool without a torn result or a false run end", async () => {
    const root = scratch();
    const child = writer(root, "oak", "crash");
    await waitMessage(child, "ready");
    const locked = waitMessage(child, "locked");
    child.send("hold");
    await locked;
    await stop(child);
    const events = rows(root);
    expect(events.map((event) => event.event_type)).toEqual(["run_started", "tool_call"]);
    expect(
      events.every(
        (event) => typeof event.payload_json === "string" && JSON.parse(event.payload_json),
      ),
    ).toBe(true);
    expect(
      openBranchAgentDatabase(input(root).database).db.prepare("PRAGMA integrity_check").get(),
    ).toEqual({ integrity_check: "ok" });
  }, 60_000);

  it("checkpoints and bounds covered journal rows through successful transcript compaction only", async () => {
    const root = scratch();
    await withRunJournal(input(root), async () => {
      const h = createSubscribedSessionHarness({
        runId: "run-1",
        sessionPersistence: "detached",
        sessionExtras: { messages: [] },
      });
      try {
        for (let pass = 0; pass < 3; pass += 1) {
          for (let index = 0; index < 10; index += 1) {
            h.emit(startEvent(`call-${index}`));
            h.emit(endEvent(`call-${index}`));
          }
          h.emit({ type: "compaction_end", reason: "threshold", outcome: { status: "aborted" } });
          expect(rows(root).length).toBeGreaterThan(20);
          h.emit({
            type: "compaction_end",
            reason: "threshold",
            outcome: { status: "completed", willRetry: false, tokensBefore: 200, tokensAfter: 100 },
          });
          expect(rows(root).map((row) => row.event_type)).toEqual(["compaction_checkpoint"]);
        }
        await h.subscription.waitForPendingEvents();
      } finally {
        h.subscription.unsubscribe();
      }
    });
    expect(rows(root).map((event) => event.event_type)).toEqual([
      "compaction_checkpoint",
      "run_ended",
    ]);
  });

  it("migrates a pre-journal per-agent database on first run without changing its version or session rows", () => {
    const root = scratch();
    const options = input(root).database;
    const initial = openBranchAgentDatabase(options);
    const dbPath = initial.path;
    const version = initial.db.prepare("PRAGMA user_version").get();
    closeBranchAgentDatabasesForTest();
    const old = new DatabaseSync(dbPath);
    old.exec("DROP TABLE run_journal");
    old.close();
    new RunJournal(input(root)).end("completed");
    expect(rows(root).map((event) => event.event_type)).toEqual(["run_started", "run_ended"]);
    expect(openBranchAgentDatabase(options).db.prepare("PRAGMA user_version").get()).toEqual(
      version,
    );
  });
});
