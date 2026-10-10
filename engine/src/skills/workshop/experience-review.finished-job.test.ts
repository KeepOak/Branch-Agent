import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmbeddedRunTrigger } from "../../agents/run-trigger.js";
import { isTrunkQueueThreadKey } from "../../agents/trunk-queue-thread-key.js";
import { buildSkillExperienceReviewPrompt } from "./experience-review-prompt.js";
import {
  createSkillExperienceReviewScheduler,
  type SkillExperienceReviewParams,
} from "./experience-review-scheduler.js";

const JOB_THREAD = "agent:builder-ash:queue-0b6c1c52-1f5e-4d43-9a43-2f7a3c1d9e10-1e053886";

function run(
  options: {
    modelIterations?: number;
    sessionKey?: string;
    success?: boolean;
    error?: string;
    mode?: "off" | "propose" | "auto";
    trigger?: EmbeddedRunTrigger;
    skillWorkshopAvailable?: boolean;
    compacted?: boolean;
  } = {},
): SkillExperienceReviewParams {
  const sessionKey = options.sessionKey ?? JOB_THREAD;
  const modelIterations = options.modelIterations ?? 1;
  return {
    event: {
      success: options.success ?? true,
      ...(options.error ? { error: options.error } : {}),
      messages: [
        { role: "user", content: "Fix the scheduler and open a draft PR." },
        ...Array.from({ length: modelIterations }, () => ({ role: "assistant", content: "work" })),
      ],
    },
    ctx: {
      agentId: "builder-ash",
      runId: "run-1",
      sessionId: "session-1",
      sessionKey,
      workspaceDir: "/workspace",
      modelProviderId: "openai",
      modelId: "gpt-test",
      modelIterations,
      skillWorkshopAvailable: options.skillWorkshopAvailable ?? true,
      ...(options.compacted ? { compacted: true } : {}),
      foregroundPromptContext: {
        agentId: "builder-ash",
        agentDir: "/agent",
        workspaceDir: "/workspace",
        cwd: "/workspace",
        sandboxSessionKey: sessionKey,
        trigger: options.trigger ?? "user",
      },
    },
    config: { skills: { workshop: { autonomous: { mode: options.mode ?? "auto" } } } },
    source: {
      agentId: "builder-ash",
      sessionId: "session-1",
      sessionKey,
      storePath: "/session-store",
      entryId: "completed-message",
      generation: "generation-1",
      rawSeq: 1,
      effectiveParentId: null,
      activeMessagePosition: 0,
    },
  };
}

function idleScheduler(isSystemActive: () => boolean = () => false) {
  const runReview = vi.fn().mockResolvedValue(undefined);
  return {
    runReview,
    scheduler: createSkillExperienceReviewScheduler({ isSystemActive, runReview }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("skill experience review of finished queued jobs", () => {
  it.each([
    [JOB_THREAD, true],
    [JOB_THREAD.toUpperCase(), true],
    ["agent:builder-ash:main", false],
    ["agent:builder-ash:queue-notes", false],
    [`${JOB_THREAD}:subagent:worker`, false],
    ["agent:builder-ash:subagent:queue-0b6c1c52-1f5e-4d43-9a43-2f7a3c1d9e10-1e053886", false],
  ])("recognizes %s as a top-level job thread: %s", (sessionKey, expected) => {
    expect(isTrunkQueueThreadKey(sessionKey)).toBe(expected);
  });

  it("reviews a one-iteration job that finished cleanly and marks it finished", async () => {
    vi.useFakeTimers();
    const { runReview, scheduler } = idleScheduler();
    scheduler.schedule(run());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runReview).toHaveBeenCalledOnce();
    expect(runReview).toHaveBeenCalledWith(
      expect.objectContaining({ finishedJob: true, turnAborted: false }),
    );
    scheduler.clear();
  });

  it.each([
    ["aborted", { success: false }],
    ["errored", { success: false, error: "provider failed" }],
    ["cron", { trigger: "cron" as const }],
    ["off", { mode: "off" as const }],
    ["unavailable", { skillWorkshopAvailable: false }],
  ])("does not review a short %s job run", async (_label, overrides) => {
    vi.useFakeTimers();
    const { runReview, scheduler } = idleScheduler();
    scheduler.schedule(run(overrides));
    await vi.runAllTimersAsync();
    expect(runReview).not.toHaveBeenCalled();
    scheduler.clear();
  });

  it("keeps the depth bar for short runs outside a job thread", async () => {
    vi.useFakeTimers();
    const { runReview, scheduler } = idleScheduler();
    scheduler.schedule(run({ sessionKey: "agent:builder-ash:main" }));
    await vi.runAllTimersAsync();
    expect(runReview).not.toHaveBeenCalled();
    scheduler.clear();
  });

  it("reviews a finished job that compacted, but not another compacted turn", async () => {
    vi.useFakeTimers();
    const { runReview, scheduler } = idleScheduler();
    scheduler.schedule(
      run({ modelIterations: 40, compacted: true, sessionKey: "agent:builder-ash:main" }),
    );
    scheduler.schedule(run({ modelIterations: 40, compacted: true }));
    await vi.runAllTimersAsync();
    expect(runReview).toHaveBeenCalledOnce();
    expect(runReview.mock.calls[0]?.[0]).toMatchObject({
      finishedJob: true,
      source: { sessionKey: JOB_THREAD },
    });
    scheduler.clear();
  });

  it("runs a finished job's review once it has waited out a never-idle system", async () => {
    vi.useFakeTimers();
    const { runReview, scheduler } = idleScheduler(() => true);
    scheduler.schedule(run({ modelIterations: 12, sessionKey: "agent:builder-ash:main" }));
    scheduler.schedule(run());
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(runReview).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(runReview).toHaveBeenCalledOnce();
    expect(runReview.mock.calls[0]?.[0]).toMatchObject({ finishedJob: true });
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(runReview).toHaveBeenCalledOnce();
    scheduler.clear();
  });
});

describe("skill experience review prompt for finished jobs", () => {
  it.each(["auto", "propose"] as const)(
    "asks a finished job's %s review for one task-type skill in SKILL.md form",
    (mode) => {
      const prompt = buildSkillExperienceReviewPrompt({ finishedJob: true }, mode);
      expect(prompt).toContain("Leave one skill for this task type");
      expect(prompt).toContain("agentskills.io SKILL.md form");
      expect(prompt).toContain("each mistake hit with its fix");
      expect(prompt).not.toContain("Most reviews need no change");
      expect(buildSkillExperienceReviewPrompt({}, mode)).not.toContain(
        "Leave one skill for this task type",
      );
    },
  );

  it("keeps the conservative review for an interrupted job", () => {
    const prompt = buildSkillExperienceReviewPrompt({ finishedJob: true, turnAborted: true });
    expect(prompt).toContain("Most reviews need no change");
    expect(prompt).not.toContain("Leave one skill for this task type");
  });
});
