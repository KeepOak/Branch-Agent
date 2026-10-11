import { createDeferred } from "branch/plugin-sdk/extension-shared";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "branch/plugin-sdk/runtime-config-snapshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./server-context.chrome-test-harness.js";
import type { RunningChrome } from "./chrome.js";
import * as chromeModule from "./chrome.js";
import { resolveBrowserConfig } from "./config.js";
import {
  isIdleEligibleManagedChrome,
  resolveLiveManagedChromeIdleTimeoutMs,
  resolveManagedChromeIdleTimeoutMs,
} from "./managed-chrome-idle.js";
import { createBrowserRouteContext } from "./server-context.js";
import {
  getProfileLifecycle,
  refreshManagedChromeIdleWatches,
  withProfileOperationLease,
} from "./server-context.lifecycle.js";
import {
  makeBrowserProfile,
  makeBrowserServerState,
  mockLaunchedChrome,
} from "./server-context.test-harness.js";

const IDLE_MS = 5 * 60_000;

function publishIdleTimeoutMinutes(minutes: number): void {
  const config = { browser: { idleTimeoutMinutes: minutes } };
  setRuntimeConfigSnapshot(config, config);
}

function markHeadless(running: RunningChrome): RunningChrome {
  running.headless = true;
  return running;
}

function setupIdleHarness(params?: {
  attachOnly?: boolean;
  headlessLaunch?: boolean;
  idleTimeoutMinutes?: number;
}) {
  const launchBranchChrome = vi.mocked(chromeModule.launchBranchChrome);
  const stopBranchChrome = vi.mocked(chromeModule.stopBranchChrome);
  const isChromeReachable = vi.mocked(chromeModule.isChromeReachable);
  const isChromeCdpReady = vi.mocked(chromeModule.isChromeCdpReady);
  const isChromeCdpOwnedByPid = vi.mocked(chromeModule.isChromeCdpOwnedByPid);

  isChromeCdpOwnedByPid.mockResolvedValue(true);
  isChromeCdpReady.mockResolvedValue(true);
  isChromeReachable.mockResolvedValue(false);

  const attachOnly = params?.attachOnly === true;
  const state = makeBrowserServerState({
    profile: makeBrowserProfile({
      attachOnly,
      headless: params?.headlessLaunch === true,
    }),
    resolvedOverrides: {
      headless: params?.headlessLaunch === true,
      attachOnly,
      idleTimeoutMinutes: params?.idleTimeoutMinutes ?? 5,
    },
  });
  publishIdleTimeoutMinutes(params?.idleTimeoutMinutes ?? 5);
  const ctx = createBrowserRouteContext({ getState: () => state });
  const profile = ctx.forProfile("branch");
  return {
    launchBranchChrome,
    stopBranchChrome,
    isChromeReachable,
    isChromeCdpReady,
    profile,
    state,
  };
}

async function launchHeadlessChrome(
  harness: ReturnType<typeof setupIdleHarness>,
  pid: number,
): Promise<RunningChrome> {
  const running = markHeadless(mockLaunchedChrome(harness.launchBranchChrome, pid));
  await harness.profile.ensureBrowserAvailable({ headless: true });
  return running;
}

beforeEach(() => {
  vi.useFakeTimers();
  clearRuntimeConfigSnapshot();
});

afterEach(() => {
  clearRuntimeConfigSnapshot();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("managed Chrome idle timeout", () => {
  it("defaults to five quiet minutes", () => {
    expect(resolveBrowserConfig(undefined).idleTimeoutMinutes).toBe(5);
    expect(resolveManagedChromeIdleTimeoutMs({ idleTimeoutMinutes: 5 })).toBe(IDLE_MS);
    expect(resolveManagedChromeIdleTimeoutMs({ idleTimeoutMinutes: 0 })).toBe(0);
    publishIdleTimeoutMinutes(0);
    expect(resolveLiveManagedChromeIdleTimeoutMs()).toBe(0);
  });

  it("closes an engine-launched headless browser after the quiet interval", async () => {
    const harness = setupIdleHarness();
    const running = await launchHeadlessChrome(harness, 701);
    expect(harness.state.profiles.get("branch")?.running).toBe(running);
    expect(harness.stopBranchChrome).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(IDLE_MS);
    await vi.waitFor(() => expect(harness.stopBranchChrome).toHaveBeenCalledExactlyOnceWith(running));
    expect(harness.state.profiles.get("branch")?.running).toBeNull();
  });

  it("resets the idle timer when the browser is used again", async () => {
    const harness = setupIdleHarness();
    const running = await launchHeadlessChrome(harness, 702);

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1_000);
    expect(harness.stopBranchChrome).not.toHaveBeenCalled();

    await harness.profile.ensureBrowserAvailable({ headless: true });
    expect(harness.launchBranchChrome).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1_000);
    expect(harness.stopBranchChrome).not.toHaveBeenCalled();
    expect(harness.state.profiles.get("branch")?.running).toBe(running);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(harness.stopBranchChrome).toHaveBeenCalledExactlyOnceWith(running));
  });

  it("does not close a headless browser while a task still holds a lease", async () => {
    const harness = setupIdleHarness();
    const running = await launchHeadlessChrome(harness, 703);
    const runtime = harness.state.profiles.get("branch");
    if (!runtime) {
      throw new Error("expected launched profile runtime");
    }

    const work = createDeferred<void>();
    const lease = withProfileOperationLease({
      state: harness.state,
      runtime,
      configRevision: getProfileLifecycle(runtime).configRevision,
      run: async () => await work.promise,
    });

    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(harness.stopBranchChrome).not.toHaveBeenCalled();
    expect(runtime.running).toBe(running);

    work.resolve();
    await lease;

    await vi.advanceTimersByTimeAsync(IDLE_MS);
    await vi.waitFor(() => expect(harness.stopBranchChrome).toHaveBeenCalledExactlyOnceWith(running));
  });

  it("does not close an attached user browser", async () => {
    const harness = setupIdleHarness({ attachOnly: true });
    harness.isChromeReachable.mockResolvedValue(true);
    harness.isChromeCdpReady.mockResolvedValue(true);

    await harness.profile.ensureBrowserAvailable();

    expect(harness.launchBranchChrome).not.toHaveBeenCalled();
    expect(harness.state.profiles.get("branch")?.running ?? null).toBeNull();

    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(harness.stopBranchChrome).not.toHaveBeenCalled();
  });

  it("does not close a headed engine-launched browser", async () => {
    const harness = setupIdleHarness();
    const running = mockLaunchedChrome(harness.launchBranchChrome, 704);
    running.headless = false;
    await harness.profile.ensureBrowserAvailable();

    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(harness.stopBranchChrome).not.toHaveBeenCalled();
    expect(harness.state.profiles.get("branch")?.running).toBe(running);
  });

  it("relaunches a headless browser on the next use after idle close", async () => {
    const harness = setupIdleHarness();
    const first = await launchHeadlessChrome(harness, 705);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    await vi.waitFor(() => expect(harness.stopBranchChrome).toHaveBeenCalledExactlyOnceWith(first));

    const second = markHeadless(mockLaunchedChrome(harness.launchBranchChrome, 706));
    await harness.profile.ensureBrowserAvailable({ headless: true });

    expect(harness.launchBranchChrome).toHaveBeenCalledTimes(2);
    expect(harness.state.profiles.get("branch")?.running).toBe(second);
  });

  it("does not close when idle timeout is disabled", async () => {
    const harness = setupIdleHarness({ idleTimeoutMinutes: 0 });
    await launchHeadlessChrome(harness, 707);

    await vi.advanceTimersByTimeAsync(IDLE_MS * 3);
    expect(harness.stopBranchChrome).not.toHaveBeenCalled();
    expect(harness.state.profiles.get("branch")?.running).not.toBeNull();
  });

  it("does not close after a live reload disables the idle timeout", async () => {
    const harness = setupIdleHarness();
    const running = await launchHeadlessChrome(harness, 709);

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1_000);
    expect(harness.stopBranchChrome).not.toHaveBeenCalled();

    publishIdleTimeoutMinutes(0);
    harness.state.resolved = { ...harness.state.resolved, idleTimeoutMinutes: 0 };
    refreshManagedChromeIdleWatches(harness.state);

    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(harness.stopBranchChrome).not.toHaveBeenCalled();
    expect(harness.state.profiles.get("branch")?.running).toBe(running);
  });

  it("does not close when only the runtime snapshot disables the idle timeout", async () => {
    const harness = setupIdleHarness();
    const running = await launchHeadlessChrome(harness, 710);
    expect(harness.state.resolved.idleTimeoutMinutes).toBe(5);

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1_000);
    publishIdleTimeoutMinutes(0);
    expect(harness.state.resolved.idleTimeoutMinutes).toBe(5);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(harness.stopBranchChrome).not.toHaveBeenCalled();
    expect(harness.state.profiles.get("branch")?.running).toBe(running);
  });

  it("treats only engine-launched headless Chrome as idle-eligible", () => {
    const launched = markHeadless(mockLaunchedChrome(vi.fn(), 708));
    const runtime = {
      profile: makeBrowserProfile(),
      running: launched,
    };
    expect(isIdleEligibleManagedChrome(runtime, launched)).toBe(true);
    expect(
      isIdleEligibleManagedChrome(
        { ...runtime, profile: makeBrowserProfile({ attachOnly: true }) },
        launched,
      ),
    ).toBe(false);
    launched.headless = false;
    expect(isIdleEligibleManagedChrome(runtime, launched)).toBe(false);
  });
});
