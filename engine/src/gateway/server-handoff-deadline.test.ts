import { afterEach, describe, expect, it, vi } from "vitest";
import timeouts from "../../../desktop/src/handoff-timeouts.json" with { type: "json" };
import {
  GatewayHandoffDeadlineError,
  HANDOFF_DEACTIVATION_BUDGET_ENV,
  HANDOFF_DEACTIVATION_MAX_MS,
  HANDOFF_OVERRUN_SETTLE_MS,
  HANDOFF_RESTORE_BUDGET_MS,
  resolveGatewayHandoffDeadline,
  resolveGatewayHandoffHardLimit,
  runBeforeHandoffDeadline,
} from "./server-handoff-deadline.js";
import { isGatewayHandoffFatalError } from "./server-handoff-error.js";

afterEach(() => vi.useRealTimers());

describe("Gateway handoff deactivation budget", () => {
  it("keeps the 18 s budget for a quiet engine", () => {
    expect(resolveGatewayHandoffDeadline({ activeRuns: 0, queuedWrites: 0 }, { now: 1, env: {} })).toEqual({
      deadline: 18_001,
      budgetMs: 18_000,
      reason: "0 active run(s), 0 queued session write(s)",
    });
  });

  it("scales with active runs and queued session writes, up to the cap", () => {
    expect(
      resolveGatewayHandoffDeadline({ activeRuns: 3, queuedWrites: 8 }, { now: 0, env: {} }),
    ).toMatchObject({ budgetMs: 26_000, reason: "3 active run(s), 8 queued session write(s)" });
    expect(
      resolveGatewayHandoffDeadline({ activeRuns: 40, queuedWrites: 0 }, { now: 0, env: {} }),
    ).toMatchObject({
      budgetMs: HANDOFF_DEACTIVATION_MAX_MS,
      reason: `40 active run(s), 0 queued session write(s), capped at ${HANDOFF_DEACTIVATION_MAX_MS} ms`,
    });
  });

  it("uses the operator override and says so", () => {
    const load = { activeRuns: 5, queuedWrites: 0 };
    expect(
      resolveGatewayHandoffDeadline(load, {
        now: 0,
        env: { [HANDOFF_DEACTIVATION_BUDGET_ENV]: "25000" },
      }),
    ).toMatchObject({ budgetMs: 25_000, reason: `${HANDOFF_DEACTIVATION_BUDGET_ENV}=25000` });
    expect(
      resolveGatewayHandoffDeadline(load, {
        now: 0,
        env: { [HANDOFF_DEACTIVATION_BUDGET_ENV]: "90000" },
      }),
    ).toMatchObject({ budgetMs: HANDOFF_DEACTIVATION_MAX_MS });
    // Not a positive number: fall back to the load-scaled budget.
    expect(
      resolveGatewayHandoffDeadline(load, { now: 0, env: { [HANDOFF_DEACTIVATION_BUDGET_ENV]: "soon" } }),
    ).toMatchObject({ budgetMs: 28_000 });
  });

  it("answers the desktop before its step-down timeout even on the slowest abort", () => {
    const slowest = resolveGatewayHandoffDeadline(
      { activeRuns: 1_000, queuedWrites: 0 },
      { now: 0, env: {} },
    );
    expect(slowest.budgetMs).toBe(HANDOFF_DEACTIVATION_MAX_MS);
    expect(resolveGatewayHandoffHardLimit(slowest)).toBeGreaterThan(
      HANDOFF_DEACTIVATION_MAX_MS + HANDOFF_OVERRUN_SETTLE_MS + HANDOFF_RESTORE_BUDGET_MS,
    );
    expect(resolveGatewayHandoffHardLimit(slowest)).toBeLessThan(timeouts.stepDownTimeoutMs);
  });
});

describe("Gateway handoff step deadline", () => {
  const deadlineIn = (ms: number) => ({ deadline: Date.now() + ms, budgetMs: ms, reason: "test" });

  it("returns an on-time step's result", async () => {
    await expect(runBeforeHandoffDeadline(Promise.resolve(7), deadlineIn(1_000))).resolves.toBe(7);
  });

  it("aborts non-fatally once an overrunning step settles", async () => {
    vi.useFakeTimers();
    const work = new Promise<number>((resolve) => setTimeout(() => resolve(7), 1_500));
    const outcome = runBeforeHandoffDeadline(work, deadlineIn(1_000)).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_500);
    const error = await outcome;
    expect(error).toBeInstanceOf(GatewayHandoffDeadlineError);
    expect(isGatewayHandoffFatalError(error)).toBe(false);
    expect(String(error)).toContain("budget 1000 ms: test");
  });

  it("accepts a late success when asked to", async () => {
    vi.useFakeTimers();
    const work = new Promise<number>((resolve) => setTimeout(() => resolve(7), 1_500));
    const outcome = runBeforeHandoffDeadline(work, deadlineIn(1_000), { lateSuccess: "accept" });
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(outcome).resolves.toBe(7);
  });

  it("is fatal only when the overrunning step never settles", async () => {
    vi.useFakeTimers();
    const outcome = runBeforeHandoffDeadline(new Promise<never>(() => {}), deadlineIn(1_000)).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(1_000 + HANDOFF_OVERRUN_SETTLE_MS);
    expect(isGatewayHandoffFatalError(await outcome)).toBe(true);
  });
});
