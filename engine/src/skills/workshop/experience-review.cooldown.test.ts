import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import type { Message } from "../../llm/types.js";
import { openBranchStateDatabase } from "../../state/branch-state-db.js";
import { createBranchTestState, type BranchTestState } from "../../test-utils/branch-test-state.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { createSkillExperienceReviewScheduler } from "./experience-review-scheduler.js";
import { claimExperienceSignalCooldown } from "./experience-review-signal-cooldown.js";
import { createExperienceReviewCandidate } from "./experience-review.test-support.js";

const config: BranchConfig = { skills: { workshop: { autonomous: { mode: "propose" } } } };
const hourMs = 60 * 60 * 1000;
const startMs = 1_800_000_000_000;
const modelId = "gpt-test";
const tempDirs = createTrackedTempDirs();
let state: BranchTestState;

beforeEach(async () => {
  state = await createBranchTestState({
    layout: "state-only",
    prefix: "branch-experience-cooldown-",
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await state.cleanup();
  await tempDirs.cleanup();
});

function execRound(id: string, command: string, isError: boolean) {
  return [
    {
      role: "assistant",
      content: [{ type: "toolCall", id, name: "exec", arguments: { command } }],
    },
    {
      role: "toolResult",
      toolCallId: id,
      toolName: "exec",
      content: [{ type: "text", text: isError ? "failed" : "ok" }],
      isError,
    },
  ];
}

function recoveryMessages(...commands: string[]) {
  const messages: unknown[] = [{ role: "user", content: "Run the release steps." }];
  for (const [index, command] of commands.entries()) {
    messages.push(...execRound(`fail-${index}`, command, true));
    messages.push(...execRound(`ok-${index}`, command, false));
  }
  return messages;
}

function createClock(): { now: number } {
  const clock = { now: startMs };
  vi.spyOn(Date, "now").mockImplementation(() => clock.now);
  return clock;
}

function createScheduler() {
  const setTimer = vi.fn((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const scheduler = createSkillExperienceReviewScheduler({
    isSystemActive: () => false,
    runReview: async () => {},
    setTimer,
    claimSignalCooldown: claimExperienceSignalCooldown,
  });
  return { scheduler, setTimer };
}

/** Returns true when the run armed a review timer, which is what scheduling means here. */
async function scheduleRun(
  scheduler: ReturnType<typeof createSkillExperienceReviewScheduler>,
  setTimer: ReturnType<typeof createScheduler>["setTimer"],
  runId: string,
  messages: unknown[],
): Promise<boolean> {
  const workspaceDir = await tempDirs.make("branch-experience-cooldown-run-");
  const candidate = await createExperienceReviewCandidate(runId, messages as Message[], {
    workspaceDir,
    modelId,
  });
  const armedBefore = setTimer.mock.calls.length;
  scheduler.schedule({
    event: { messages, success: true },
    ctx: {
      runId,
      sessionKey: candidate.source.sessionKey,
      workspaceDir,
      modelProviderId: "openai",
      modelId,
      foregroundPromptContext: candidate.ctx.foregroundPromptContext,
      skillWorkshopAvailable: true,
    },
    config,
    source: candidate.source,
  });
  return setTimer.mock.calls.length > armedBefore;
}

describe("repeated-failure signal cooldown", () => {
  it("blocks the same identity inside 24 hours, including after a restart", async () => {
    const clock = createClock();
    const first = createScheduler();
    expect(
      await scheduleRun(
        first.scheduler,
        first.setTimer,
        "cooldown-1",
        recoveryMessages("tilectl publish --manifest a.json"),
      ),
    ).toBe(true);
    first.scheduler.clear();

    clock.now = startMs + 23 * hourMs;
    const restarted = createScheduler();
    expect(
      await scheduleRun(
        restarted.scheduler,
        restarted.setTimer,
        "cooldown-2",
        recoveryMessages("tilectl publish --manifest b.json"),
      ),
    ).toBe(false);
    restarted.scheduler.clear();
  });

  it("schedules a different identity inside the cooldown window", async () => {
    const clock = createClock();
    const { scheduler, setTimer } = createScheduler();
    expect(
      await scheduleRun(
        scheduler,
        setTimer,
        "other-1",
        recoveryMessages("tilectl publish --manifest a.json"),
      ),
    ).toBe(true);
    clock.now = startMs + hourMs;
    expect(
      await scheduleRun(scheduler, setTimer, "other-2", recoveryMessages("tilectl status")),
    ).toBe(true);
    scheduler.clear();
  });

  it("allows the same identity again once 24 hours have passed", async () => {
    const clock = createClock();
    const { scheduler, setTimer } = createScheduler();
    expect(
      await scheduleRun(
        scheduler,
        setTimer,
        "expiry-1",
        recoveryMessages("tilectl publish --manifest a.json"),
      ),
    ).toBe(true);
    clock.now = startMs + 24 * hourMs;
    expect(
      await scheduleRun(
        scheduler,
        setTimer,
        "expiry-2",
        recoveryMessages("tilectl publish --manifest b.json"),
      ),
    ).toBe(true);
    scheduler.clear();
  });

  it("claims only the first recovered identity of a run and keeps command text out of state", async () => {
    createClock();
    const { scheduler, setTimer } = createScheduler();
    expect(
      await scheduleRun(
        scheduler,
        setTimer,
        "multi-1",
        recoveryMessages("tilectl publish --manifest a.json", "tilectl status"),
      ),
    ).toBe(true);
    expect(
      await scheduleRun(scheduler, setTimer, "multi-2", recoveryMessages("tilectl status")),
    ).toBe(true);
    scheduler.clear();
    const row = openBranchStateDatabase()
      .db.prepare("SELECT value_json FROM config_machine_state WHERE state_key = ?")
      .get("skills.gardenerState") as { value_json: string } | undefined;
    expect(row?.value_json).toContain("experienceSignalClaims");
    expect(row?.value_json).not.toContain("tilectl");
  });
});
