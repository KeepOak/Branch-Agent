// A full worker queue refuses a user turn write before it runs; the turn is still stored.
import { afterAll, describe, expect, it, vi } from "vitest";
import { persistSessionTranscriptTurn } from "../config/sessions/session-accessor.js";
import { WorkerTaskError } from "../infra/worker-task-pool.js";
import { useSessionStoreTempDirs } from "../test-utils/session-state-cleanup.js";
import { createUserTurnTranscriptRecorder } from "./user-turn-transcript.js";
import {
  createSqliteTranscriptTarget,
  readTranscriptMessages,
} from "./user-turn-transcript.test-support.js";

vi.mock("../config/sessions/session-accessor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions/session-accessor.js")>();
  return { ...actual, persistSessionTranscriptTurn: vi.fn(actual.persistSessionTranscriptTurn) };
});

const queueFull = () => new WorkerTaskError("worker task capacity reached", "overloaded");

describe("user turn transcript on a full worker queue", () => {
  const sessionDirs = useSessionStoreTempDirs(afterAll, "branch-user-turn-overload-");

  it("stores the turn when the first write is refused", async () => {
    const target = createSqliteTranscriptTarget({ dir: sessionDirs.make() });
    vi.mocked(persistSessionTranscriptTurn).mockRejectedValueOnce(queueFull());
    const recorder = createUserTurnTranscriptRecorder({
      target,
      input: { text: "Do the queued job.", timestamp: 1 },
      updateMode: "none",
    });

    await expect(recorder.persistApproved()).resolves.toMatchObject({ appended: true });

    expect(await readTranscriptMessages(target)).toMatchObject([
      { role: "user", content: "Do the queued job." },
    ]);
  });

  it("lets the failure path store the turn after every try was refused", async () => {
    const target = createSqliteTranscriptTarget({ dir: sessionDirs.make() });
    for (let refusal = 0; refusal < 5; refusal += 1) {
      vi.mocked(persistSessionTranscriptTurn).mockRejectedValueOnce(queueFull());
    }
    const recorder = createUserTurnTranscriptRecorder({
      target,
      input: { text: "Do the failed job.", timestamp: 1 },
      updateMode: "none",
    });

    await expect(recorder.persistApproved()).rejects.toThrow("worker task capacity reached");
    expect(recorder.hasPersisted()).toBe(false);
    await expect(recorder.persistFallback()).resolves.toMatchObject({ appended: true });

    expect(await readTranscriptMessages(target)).toMatchObject([
      { role: "user", content: "Do the failed job." },
    ]);
  }, 20_000);
});
