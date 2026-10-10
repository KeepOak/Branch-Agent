import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { sha256Hex } from "../../infra/crypto-digest.js";
import type { Message } from "../../llm/types.js";
import { openBranchStateDatabase } from "../../state/branch-state-db.js";
import { createBranchTestState, type BranchTestState } from "../../test-utils/branch-test-state.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { recordSkillExperienceReviewOutcomeInDatabase } from "./collection-review.kernel.js";
import { createSkillExperienceReviewScheduler } from "./experience-review-scheduler.js";
import { claimExperienceSignalCooldown } from "./experience-review-signal-cooldown.js";

const KEY_FILENAME = "experience-signal-claims.key";
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
  const clearTimer = vi.fn((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer));
  const scheduler = createSkillExperienceReviewScheduler({
    isSystemActive: () => false,
    runReview: async () => {},
    setTimer,
    clearTimer,
    claimSignalCooldown: claimExperienceSignalCooldown,
  });
  return { scheduler, setTimer, clearTimer };
}

/** True when the run's review is still queued: armed, and not withdrawn by a denied claim. */
async function scheduleRun(
  scheduler: ReturnType<typeof createScheduler>["scheduler"],
  timers: Pick<ReturnType<typeof createScheduler>, "setTimer" | "clearTimer">,
  runId: string,
  messages: unknown[],
): Promise<boolean> {
  const workspaceDir = await tempDirs.make("branch-experience-cooldown-run-");
  const candidate = await createExperienceReviewCandidate(runId, messages as Message[], {
    workspaceDir,
    modelId,
  });
  const armedBefore = timers.setTimer.mock.calls.length;
  const clearedBefore = timers.clearTimer.mock.calls.length;
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
  const armed = timers.setTimer.mock.calls.length > armedBefore;
  const withdrawn = timers.clearTimer.mock.calls.length > clearedBefore;
  return armed && !withdrawn;
}

describe("repeated-failure signal cooldown", () => {
  it("blocks the same identity inside 24 hours, including after a restart", async () => {
    const clock = createClock();
    const first = createScheduler();
    expect(
      await scheduleRun(
        first.scheduler,
        first,
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
        restarted,
        "cooldown-2",
        recoveryMessages("tilectl publish --manifest b.json"),
      ),
    ).toBe(false);
    restarted.scheduler.clear();
  });

  it("schedules a different identity inside the cooldown window", async () => {
    const clock = createClock();
    const timers = createScheduler();
    const { scheduler } = timers;
    expect(
      await scheduleRun(
        scheduler,
        timers,
        "other-1",
        recoveryMessages("tilectl publish --manifest a.json"),
      ),
    ).toBe(true);
    clock.now = startMs + hourMs;
    expect(
      await scheduleRun(scheduler, timers, "other-2", recoveryMessages("tilectl status")),
    ).toBe(true);
    scheduler.clear();
  });

  it("allows the same identity again once 24 hours have passed", async () => {
    const clock = createClock();
    const timers = createScheduler();
    const { scheduler } = timers;
    expect(
      await scheduleRun(
        scheduler,
        timers,
        "expiry-1",
        recoveryMessages("tilectl publish --manifest a.json"),
      ),
    ).toBe(true);
    clock.now = startMs + 24 * hourMs;
    expect(
      await scheduleRun(
        scheduler,
        timers,
        "expiry-2",
        recoveryMessages("tilectl publish --manifest b.json"),
      ),
    ).toBe(true);
    scheduler.clear();
  });

  it("claims only the first recovered identity of a run", async () => {
    createClock();
    const timers = createScheduler();
    const { scheduler } = timers;
    expect(
      await scheduleRun(
        scheduler,
        timers,
        "multi-1",
        recoveryMessages("tilectl publish --manifest a.json", "tilectl status"),
      ),
    ).toBe(true);
    expect(
      await scheduleRun(scheduler, timers, "multi-2", recoveryMessages("tilectl status")),
    ).toBe(true);
    scheduler.clear();
  });

  it("keeps claims through a rewrite of the gardener review row", async () => {
    createClock();
    const timers = createScheduler();
    const { scheduler } = timers;
    expect(
      await scheduleRun(
        scheduler,
        timers,
        "rewrite-1",
        recoveryMessages("tilectl publish --manifest a.json"),
      ),
    ).toBe(true);
    scheduler.clear();
    recordSkillExperienceReviewOutcomeInDatabase(openBranchStateDatabase(), {
      agentId: "main",
      workspaceDir: "/workspace",
      review: { attemptedAtMs: startMs, outcome: "nothing" },
    });
    expect(
      claimExperienceSignalCooldown({
        agentId: "main",
        identity: JSON.stringify(["exec", "tilectl publish"]),
        nowMs: startMs + hourMs,
      }),
    ).toBe(false);
  });

  it("stores only keyed hashes of identities, never command text", async () => {
    createClock();
    const timers = createScheduler();
    const { scheduler } = timers;
    await scheduleRun(
      scheduler,
      timers,
      "privacy-1",
      recoveryMessages("tilectl publish --manifest a.json"),
    );
    scheduler.clear();
    const stored = readClaimsRow();
    expect(stored.value_json).not.toContain("tilectl");
    expect(stored.value_json).not.toContain("publish");
    const plainKey = sha256Hex(`main\0${JSON.stringify(["exec", "tilectl publish"])}`);
    expect(Object.keys(JSON.parse(stored.value_json).claims)).not.toContain(plainKey);
  });

  it("keeps the HMAC key in a 0600 file beside the database, never in the row", async () => {
    createClock();
    const timers = createScheduler();
    await scheduleRun(
      timers.scheduler,
      timers,
      "key-1",
      recoveryMessages("tilectl publish --manifest a.json"),
    );
    timers.scheduler.clear();
    const keyPath = path.join(path.dirname(openBranchStateDatabase().path), KEY_FILENAME);
    const key = fs.readFileSync(keyPath);
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(key.length).toBe(32);
    const stored = readClaimsRow().value_json;
    expect(stored).not.toContain(key.toString("hex"));
    expect(stored).not.toContain(key.toString("base64"));
    expect(JSON.parse(stored)).not.toHaveProperty("secret");
    const identity = JSON.stringify(["exec", "tilectl publish"]);
    const keyed = createHmac("sha256", key).update(`main\0${identity}`).digest("hex");
    expect(Object.keys(JSON.parse(stored).claims)).toEqual([keyed]);
  });

  it("fails closed when the claim lock is held past its budget", () => {
    const holder = new DatabaseSync(openBranchStateDatabase().path);
    const identity = JSON.stringify(["exec", "tilectl publish"]);
    holder.exec("BEGIN IMMEDIATE");
    try {
      const started = Date.now();
      const claimed = claimExperienceSignalCooldown({ agentId: "main", identity, nowMs: startMs });
      expect(claimed).toBe(false);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    expect(claimExperienceSignalCooldown({ agentId: "main", identity, nowMs: startMs })).toBe(true);
  });
});

function readClaimsRow(): { value_json: string } {
  const row = openBranchStateDatabase()
    .db.prepare("SELECT value_json FROM config_machine_state WHERE state_key = ?")
    .get("skills.experienceSignalClaims") as { value_json: string } | undefined;
  if (!row) {
    throw new Error("No claims row was written.");
  }
  return row;
}
