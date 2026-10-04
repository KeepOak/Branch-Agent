import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { createMemoryBlobStore } from "./memory-blob-store.test-support.js";
import { A2aStateTaskPersistence, getObjectPath, isTaskIdValid } from "./persistence.js";
import type { A2aTaskRecord } from "./protocol.js";
import { A2A_RESTART_INTERRUPTED_MESSAGE, A2aTaskStore, type A2aPersistedTask } from "./task-store.js";

// Ported from gemini-cli packages/a2a-server/src/persistence/gcs.test.ts
// (GCSTaskStore save/load/path-safety cases) onto Branch's plugin state store.

function createTask(id: string, state: A2aTaskRecord["status"]["state"]): A2aTaskRecord {
  return {
    id,
    contextId: "ctx-1",
    status: { state, timestamp: "2026-10-04T10:00:00.000Z" },
    artifacts: [],
    history: [],
  } as A2aTaskRecord;
}

function createPersistence() {
  const blobs = createMemoryBlobStore<{ taskId: string; ownerPeer?: string }>();
  return { blobs, persistence: new A2aStateTaskPersistence(blobs) };
}

describe("A2aStateTaskPersistence (ported GCSTaskStore cases)", () => {
  describe("save", () => {
    it("should save metadata as a gzip JSON object keyed by caller and task", async () => {
      const { blobs, persistence } = createPersistence();
      const entry: A2aPersistedTask = {
        task: createTask("task1", "TASK_STATE_WORKING"),
        ownerPeer: "alpha",
      };

      await persistence.save(entry);

      expect(blobs.keys()).toEqual(["tasks/alpha/task1/metadata.json.gz"]);
      const stored = await blobs.lookup("tasks/alpha/task1/metadata.json.gz");
      expect(stored?.metadata).toEqual({ taskId: "task1", ownerPeer: "alpha" });
      expect(JSON.parse(gunzipSync(stored!.bytes).toString())).toEqual(entry);
    });

    it("should propagate a storage write failure", async () => {
      const { blobs, persistence } = createPersistence();
      vi.spyOn(blobs, "register").mockRejectedValueOnce(new Error("disk full"));

      await expect(
        persistence.save({ task: createTask("task1", "TASK_STATE_WORKING") }),
      ).rejects.toThrow("disk full");
    });

    it("should throw an error if taskId contains path traversal sequences", async () => {
      const { blobs, persistence } = createPersistence();
      const maliciousTask = createTask("../../../malicious-task", "TASK_STATE_WORKING");

      await expect(persistence.save({ task: maliciousTask })).rejects.toThrow(
        "Invalid taskId: ../../../malicious-task",
      );
      expect(blobs.keys()).toEqual([]);
    });
  });

  describe("load", () => {
    it("should load task metadata", async () => {
      const { persistence } = createPersistence();
      const entry: A2aPersistedTask = {
        task: createTask("task1", "TASK_STATE_COMPLETED"),
        ownerPeer: "alpha",
        finishedAt: 1_000,
      };
      await persistence.save(entry);

      await expect(persistence.load("task1", "alpha")).resolves.toEqual(entry);
    });

    it("should return undefined if metadata not found", async () => {
      const { persistence } = createPersistence();

      await expect(persistence.load("task1", "alpha")).resolves.toBeUndefined();
    });

    it("should not load another caller's task by id", async () => {
      const { persistence } = createPersistence();
      await persistence.save({ task: createTask("task1", "TASK_STATE_WORKING"), ownerPeer: "alpha" });

      await expect(persistence.load("task1", "beta")).resolves.toBeUndefined();
    });

    it("should reject metadata that is missing internal persisted state", async () => {
      const { blobs, persistence } = createPersistence();
      await blobs.register(
        getObjectPath("task1", "metadata", "alpha"),
        gzipSync(Buffer.from(JSON.stringify({ id: "task1" }))),
        { taskId: "task1", ownerPeer: "alpha" },
      );

      await expect(persistence.load("task1", "alpha")).rejects.toThrow(
        "missing internal persisted state",
      );
      const onCorrupt = vi.fn();
      await expect(persistence.loadAll(onCorrupt)).resolves.toEqual([]);
      expect(onCorrupt).toHaveBeenCalledOnce();
    });
  });

  it("should throw an error if taskId contains path traversal sequences", async () => {
    const { persistence } = createPersistence();
    const maliciousTaskId = "../../../malicious-task";

    await expect(persistence.load(maliciousTaskId)).rejects.toThrow(
      `Invalid taskId: ${maliciousTaskId}`,
    );
  });

  it.each([
    ["task-1_A", true],
    ["550e8400-e29b-41d4-a716-446655440000", true],
    ["", false],
    ["a/b", false],
    ["..", false],
  ])("validates task id %j as %s", (taskId, valid) => {
    expect(isTaskIdValid(taskId)).toBe(valid);
  });
});

describe("A2A task store restart recovery", () => {
  it("restores finished tasks for their caller and settles interrupted ones", async () => {
    const { persistence } = createPersistence();
    const first = new A2aTaskStore({ persistence });
    const done = first.create("ctx-done", "alpha");
    first.completeNext("ctx-done", "kept answer", "alpha");
    const running = first.create("ctx-running", "alpha");
    first.start(running.id);
    first.setPushConfig(running.id, "alpha", { url: "https://hooks.example.test/a2a" });
    await first.flush();
    first.stop();

    const second = new A2aTaskStore({ persistence });
    await second.restore();

    expect(second.get(done.id, "alpha")).toMatchObject({
      status: { state: "TASK_STATE_COMPLETED" },
      artifacts: [{ parts: [{ text: "kept answer" }] }],
    });
    expect(second.get(done.id, "beta")).toBeUndefined();
    expect(second.get(running.id, "alpha")?.status).toMatchObject({
      state: "TASK_STATE_FAILED",
      message: { parts: [{ text: A2A_RESTART_INTERRUPTED_MESSAGE }] },
    });
    expect(second.listPushConfigs(running.id, "alpha")).toEqual([
      expect.objectContaining({ url: "https://hooks.example.test/a2a" }),
    ]);
    await second.flush();
    await expect(persistence.load(running.id, "alpha")).resolves.toMatchObject({
      task: { status: { state: "TASK_STATE_FAILED" } },
    });
    second.stop();
  });

  it("deletes persisted records when finished tasks age out", async () => {
    const { blobs, persistence } = createPersistence();
    const store = new A2aTaskStore({ persistence });
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const task = store.create("ctx-old", "alpha");
    store.completeNext("ctx-old", "done", "alpha");
    await store.flush();
    expect(blobs.keys()).toHaveLength(1);

    clock.mockReturnValue(1_800_000_000_000 + 24 * 60 * 60 * 1000);
    expect(store.get(task.id)).toBeUndefined();
    await store.flush();

    expect(blobs.keys()).toEqual([]);
    clock.mockRestore();
    store.stop();
  });

  it("reports persistence failures without failing the task", async () => {
    const { blobs, persistence } = createPersistence();
    vi.spyOn(blobs, "register").mockRejectedValue(new Error("disk full"));
    const onPersistenceError = vi.fn();
    const store = new A2aTaskStore({ persistence, onPersistenceError });

    const task = store.create("ctx", "alpha");
    store.completeNext("ctx", "answer", "alpha");
    await store.flush();

    expect(task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(onPersistenceError).toHaveBeenCalledWith(expect.objectContaining({ message: "disk full" }));
    store.stop();
  });
});
