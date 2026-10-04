// AUTOMATION-0200: per-job learnings, copied from MarlBurroW/hivekeep cron-learnings.
import { afterEach, describe, expect, it } from "vitest";
import {
  createCronLearningTools,
  resolveCronRunScope,
} from "../agents/tools/cron-learning-tools.js";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import {
  appendCronLearningsToCommandBody,
  deleteCronLearning,
  fetchCronLearnings,
  fetchCronLearningsByRun,
  MAX_LEARNINGS_PER_CRON,
  saveCronLearning,
} from "./cron-learnings.js";

const RUN_KEY = "agent:main:cron:job-1:run:run-7";

afterEach(async () => {
  await closeBranchStateDatabaseAsync();
});

function details(result: unknown): Record<string, unknown> {
  return (result as { details: Record<string, unknown> }).details;
}

describe("cron learnings store", () => {
  it("dedupes by trimmed case-insensitive content and keeps chronological order", async () => {
    await withBranchTestState({ label: "cron-learnings-dedupe" }, async () => {
      const first = await saveCronLearning({ jobId: "job-1", content: "  Use header X  ", nowMs: 1 });
      const again = await saveCronLearning({ jobId: "job-1", content: "use HEADER x", nowMs: 2 });
      await saveCronLearning({ jobId: "job-1", content: "Second", category: "optimization", nowMs: 3 });
      expect(again.id).toBe(first.id);
      const learnings = await fetchCronLearnings("job-1");
      expect(learnings.map((learning) => learning.content)).toEqual(["Use header X", "Second"]);
      expect(learnings[1]?.category).toBe("optimization");
      expect(await fetchCronLearnings("job-2")).toEqual([]);
    });
  });

  it("rejects empty content", async () => {
    await withBranchTestState({ label: "cron-learnings-empty" }, async () => {
      await expect(saveCronLearning({ jobId: "job-1", content: "   " })).rejects.toThrow(
        "Learning content cannot be empty",
      );
    });
  });

  it("evicts the oldest learning once the per-job cap is reached", async () => {
    await withBranchTestState({ label: "cron-learnings-evict" }, async () => {
      for (let index = 0; index <= MAX_LEARNINGS_PER_CRON; index += 1) {
        await saveCronLearning({ jobId: "job-1", content: `lesson ${index}`, nowMs: index });
      }
      const learnings = await fetchCronLearnings("job-1");
      expect(learnings).toHaveLength(MAX_LEARNINGS_PER_CRON);
      expect(learnings[0]?.content).toBe("lesson 1");
      expect(learnings.at(-1)?.content).toBe(`lesson ${MAX_LEARNINGS_PER_CRON}`);
    });
  });

  it("deletes by id and reads back learnings of one run", async () => {
    await withBranchTestState({ label: "cron-learnings-delete" }, async () => {
      const kept = await saveCronLearning({ jobId: "job-1", content: "keep", runId: "run-a" });
      const dropped = await saveCronLearning({ jobId: "job-1", content: "drop", runId: "run-b" });
      expect(await deleteCronLearning({ jobId: "job-1", learningId: dropped.id })).toBe(true);
      expect(await deleteCronLearning({ jobId: "job-1", learningId: dropped.id })).toBe(false);
      expect((await fetchCronLearnings("job-1")).map((learning) => learning.id)).toEqual([kept.id]);
      expect(await fetchCronLearningsByRun("job-1", "run-a")).toHaveLength(1);
      expect(await fetchCronLearningsByRun("job-1", "run-b")).toHaveLength(0);
    });
  });
});

describe("cron learning tools", () => {
  it("exist only in isolated scheduled runs and scope to the run's job", async () => {
    expect(resolveCronRunScope(RUN_KEY)).toEqual({ jobId: "job-1", runId: "run-7" });
    expect(resolveCronRunScope("agent:main:cron:job-1")).toBeUndefined();
    expect(resolveCronRunScope("agent:main:main")).toBeUndefined();
    expect(createCronLearningTools({ runSessionKey: "agent:main:main" })).toEqual([]);

    await withBranchTestState({ label: "cron-learnings-tools" }, async () => {
      const [save, remove] = createCronLearningTools({ runSessionKey: RUN_KEY });
      expect(save?.name).toBe("save_run_learning");
      expect(remove?.name).toBe("delete_run_learning");
      const saved = details(await save?.execute("call-1", { content: "Retry after 429" }));
      expect(saved.success).toBe(true);
      const [learning] = await fetchCronLearningsByRun("job-1", "run-7");
      expect(learning?.id).toBe(saved.learningId);
      expect(details(await save?.execute("call-2", { content: " " })).error).toBe(
        "Learning content cannot be empty",
      );
      expect(details(await remove?.execute("call-3", { learning_id: "missing" })).error).toBe(
        "Learning not found.",
      );
      expect(details(await remove?.execute("call-4", { learning_id: learning?.id })).success).toBe(
        true,
      );
    });
  });

  it("hands saved learnings to the next run prompt", async () => {
    await withBranchTestState({ label: "cron-learnings-prompt" }, async () => {
      expect(await appendCronLearningsToCommandBody("[cron:job-1 Daily] go", "job-1")).toBe(
        "[cron:job-1 Daily] go",
      );
      const learning = await saveCronLearning({
        jobId: "job-1",
        content: "The feed moved to /v2",
        category: "environment",
      });
      const prompt = await appendCronLearningsToCommandBody("[cron:job-1 Daily] go", "job-1");
      expect(prompt).toContain("Learnings saved by earlier runs of this scheduled job");
      expect(prompt).toContain(`- [${learning.id}] (environment) The feed moved to /v2`);
    });
  });
});
