import { getRuntimeConfig } from "branch/plugin-sdk/runtime-config-snapshot";
import type { RunningChrome } from "./chrome.js";
import { DEFAULT_BROWSER_IDLE_TIMEOUT_MINUTES } from "./constants.js";
import { resolveBrowserConfig, type ResolvedBrowserConfig } from "./config.js";
import type { ProfileRuntimeState } from "./server-context.types.js";

type ManagedChromeIdleWatch = {
  runtime: ProfileRuntimeState;
  getBusy: () => boolean;
  getRunning: () => RunningChrome | null;
  getTimeoutMs: () => number;
  close: () => void | Promise<void>;
};

const idleWatches = new WeakMap<ProfileRuntimeState, ReturnType<typeof setTimeout>>();

export function minutesToIdleTimeoutMs(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 0;
  }
  return Math.floor(minutes * 60_000);
}

export function resolveManagedChromeIdleTimeoutMs(
  resolved: Pick<ResolvedBrowserConfig, "idleTimeoutMinutes">,
): number {
  return minutesToIdleTimeoutMs(resolved.idleTimeoutMinutes ?? DEFAULT_BROWSER_IDLE_TIMEOUT_MINUTES);
}

/** Live Gateway snapshot, same source tab cleanup uses after a hot save. */
export function resolveLiveManagedChromeIdleTimeoutMs(): number {
  const cfg = getRuntimeConfig();
  return resolveManagedChromeIdleTimeoutMs(resolveBrowserConfig(cfg.browser, cfg));
}

/** True only for a Chrome process this runtime launched in headless mode. */
export function isIdleEligibleManagedChrome(
  runtime: ProfileRuntimeState,
  running: RunningChrome | null,
): running is RunningChrome {
  if (!running || running.headless !== true) {
    return false;
  }
  const profile = runtime.profile;
  return profile.driver === "branch" && profile.cdpIsLoopback && !profile.attachOnly;
}

export function clearManagedChromeIdleWatch(runtime: ProfileRuntimeState): void {
  const timer = idleWatches.get(runtime);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  idleWatches.delete(runtime);
}

export function armManagedChromeIdleWatch(target: ManagedChromeIdleWatch): void {
  clearManagedChromeIdleWatch(target.runtime);
  if (target.getBusy()) {
    return;
  }
  const running = target.getRunning();
  if (!isIdleEligibleManagedChrome(target.runtime, running)) {
    return;
  }
  const timeoutMs = target.getTimeoutMs();
  if (timeoutMs <= 0) {
    return;
  }
  const handle = running;
  const armedTimeoutMs = timeoutMs;
  const timer = setTimeout(() => {
    idleWatches.delete(target.runtime);
    if (target.getBusy()) {
      return;
    }
    if (target.getRunning() !== handle) {
      return;
    }
    if (!isIdleEligibleManagedChrome(target.runtime, handle)) {
      return;
    }
    const currentTimeoutMs = target.getTimeoutMs();
    if (currentTimeoutMs <= 0) {
      return;
    }
    if (currentTimeoutMs !== armedTimeoutMs) {
      armManagedChromeIdleWatch(target);
      return;
    }
    void Promise.resolve(target.close()).catch(() => {
      // Best-effort idle close. Shutdown still owns hard cleanup.
    });
  }, timeoutMs);
  timer.unref?.();
  idleWatches.set(target.runtime, timer);
}
