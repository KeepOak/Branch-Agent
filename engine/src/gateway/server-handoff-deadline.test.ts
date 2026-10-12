import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GatewayHandoffDeadlineError,
  HANDOFF_DEACTIVATION_BASE_MS,
  HANDOFF_DEACTIVATION_MAX_MS,
  raceHandoffDeadline,
  resolveHandoffDeactivationBudget,
  settlesWithin,
} from "./server-handoff-deadline.js";

afterEach(() => vi.useRealTimers());

describe("handoff step-down deadline (#481)", () => {
  it("keeps the 18 s base on an idle host and says why", () => {
    expect(resolveHandoffDeactivationBudget({ activeRuns: 0, queuedCommands: 0 })).toEqual({
      ms: HANDOFF_DEACTIVATION_BASE_MS,
      reason: "0 active run(s), 0 queued command(s)",
    });
  });

  it("scales with active runs and queued commands, capped below the desktop's step-down wait", () => {
    expect(resolveHandoffDeactivationBudget({ activeRuns: 3, queuedCommands: 4 }).ms).toBe(29_000);
    const loaded = resolveHandoffDeactivationBudget({ activeRuns: 40, queuedCommands: 100 });
    expect(loaded.ms).toBe(HANDOFF_DEACTIVATION_MAX_MS);
    expect(loaded.reason).toContain("capped");
    expect(HANDOFF_DEACTIVATION_MAX_MS).toBeLessThan(60_000);
  });

  it("takes a configured deadline within the same bounds", () => {
    const env = { BRANCH_GATEWAY_HANDOFF_DEADLINE_MS: "30000" } as NodeJS.ProcessEnv;
    expect(resolveHandoffDeactivationBudget({ activeRuns: 0, queuedCommands: 0, env })).toEqual({
      ms: 30_000,
      reason: "configured by BRANCH_GATEWAY_HANDOFF_DEADLINE_MS=30000",
    });
    const tiny = { BRANCH_GATEWAY_HANDOFF_DEADLINE_MS: "5" } as NodeJS.ProcessEnv;
    expect(
      resolveHandoffDeactivationBudget({ activeRuns: 0, queuedCommands: 0, env: tiny }).ms,
    ).toBe(HANDOFF_DEACTIVATION_BASE_MS);
  });

  it("rejects an overrun with a retryable error that still tracks the late step", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const late = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const raced = raceHandoffDeadline(late, Date.now() + 1_000, 1_000, "cron drain");
    const rejection = expect(raced).rejects.toBeInstanceOf(GatewayHandoffDeadlineError);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    const error = await raced.catch((caught: unknown) => caught as GatewayHandoffDeadlineError);
    expect(error.message).toBe(
      "Gateway handoff deactivation exceeded 1 seconds at cron drain; the handoff was aborted and this engine keeps serving",
    );
    const settled = settlesWithin(error.settled, 5_000);
    finish();
    await expect(settled).resolves.toBe(true);
  });

  it("reports a step that never settles", async () => {
    vi.useFakeTimers();
    const settled = settlesWithin(new Promise<void>(() => {}), 2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(settled).resolves.toBe(false);
  });
});
