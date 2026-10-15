import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PREPARED_RUNTIME_SUPERSEDED_TOTAL_CAP_MS } from "../../prepared-model-runtime-lease.js";
import { PreparedModelRuntimePublicationSupersededError } from "../../prepared-model-runtime.errors.js";
import {
  notifyPreparedModelRuntimePublication,
  resetPreparedModelRuntimePublicationListenersForTest,
} from "../../prepared-model-runtime.publication-events.js";
import { createSupersededSetupRetry } from "./superseded-setup-retry.js";

const logInfo = vi.hoisted(() => vi.fn());
vi.mock("../logger.js", () => ({ log: { info: logInfo } }));

const superseded = () =>
  new PreparedModelRuntimePublicationSupersededError(
    "prepared model runtime publication was superseded for the agent directory",
  );

// Stops a loop that never waits, so a regression fails the test instead of hanging it.
const FUSE = 200;

function supersededRun(options: { succeedAfter?: number } = {}) {
  const abort = new AbortController();
  const retry = createSupersededSetupRetry(() => ({
    runId: "run-busy",
    abortSignal: abort.signal,
  }));
  let calls = 0;
  const refresh = {
    run: async (generation: () => Promise<string>) => {
      calls += 1;
      if (calls >= FUSE) {
        abort.abort(new Error("fuse"));
      }
      if (options.succeedAfter !== undefined && calls > options.succeedAfter) {
        return await generation();
      }
      throw superseded();
    },
  };
  // The superseded generation has already settled and no newer publication is pending.
  const settled = vi.fn(async () => {});
  const result = retry.run(refresh, async () => "ran", settled);
  result.catch(() => {});
  return { result, calls: () => calls, settled, abort };
}

describe("createSupersededSetupRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logInfo.mockReset();
  });
  afterEach(() => {
    resetPreparedModelRuntimePublicationListenersForTest();
    vi.useRealTimers();
  });

  it("backs off instead of spinning when settled() resolves at once", async () => {
    const run = supersededRun();
    await vi.advanceTimersByTimeAsync(0);
    expect(run.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(run.calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(run.calls()).toBe(3);
    // 250 + 500 + 1000 + 2000 + 4000, then 5 s apart: 60 s holds about 16 attempts, not thousands.
    await vi.advanceTimersByTimeAsync(60_000 - 750);
    expect(run.calls()).toBeLessThanOrEqual(20);
    expect(run.calls()).toBeGreaterThan(10);
    expect(logInfo).toHaveBeenCalledTimes(1);
    expect(logInfo.mock.calls[0]?.[0]).toContain("runtime was replaced during setup");
    run.abort.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(run.result).rejects.toThrow("publication was superseded");
  });

  it("stops at the supersession budget with a bounded number of attempts", async () => {
    const run = supersededRun();
    await vi.advanceTimersByTimeAsync(PREPARED_RUNTIME_SUPERSEDED_TOTAL_CAP_MS + 10_000);
    await expect(run.result).rejects.toThrow("publication was superseded");
    // 600 s at 5 s apart: about 120 attempts over the whole budget.
    expect(run.calls()).toBeLessThan(FUSE);
    expect(run.calls()).toBeGreaterThan(100);
    expect(logInfo).toHaveBeenCalledTimes(2);
    expect(logInfo.mock.calls[1]?.[0]).toMatch(/stopped waiting .* after \d+ retries/);
  });

  it("rejoins as soon as a newer publication lands and logs the retry count once", async () => {
    const run = supersededRun({ succeedAfter: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(run.calls()).toBe(1);
    notifyPreparedModelRuntimePublication({ phase: "published" });
    await vi.advanceTimersByTimeAsync(0);
    expect(run.calls()).toBe(2);
    notifyPreparedModelRuntimePublication({ phase: "invalidated" });
    await vi.advanceTimersByTimeAsync(0);
    await expect(run.result).resolves.toBe("ran");
    expect(run.calls()).toBe(3);
    expect(run.settled).toHaveBeenCalledTimes(2);
    expect(logInfo.mock.calls.map(([line]) => line)).toEqual([
      expect.stringContaining("runtime was replaced during setup"),
      expect.stringContaining("rejoined the current publication after 2 retries"),
    ]);
  });

  it("stops waiting when the run is aborted", async () => {
    const run = supersededRun();
    await vi.advanceTimersByTimeAsync(0);
    run.abort.abort();
    await vi.advanceTimersByTimeAsync(0);
    await expect(run.result).rejects.toThrow("publication was superseded");
    expect(run.calls()).toBe(2);
  });
});
