import { createDeferred } from "branch/plugin-sdk/extension-shared";
import * as runtimeEnv from "branch/plugin-sdk/runtime-env";
import { vi } from "vitest";

// Worker replies use real I/O; only advance the retry clock after its timer exists.
export function observeRetryBackoffs(count: number) {
  const entered = Array.from({ length: count }, () => createDeferred<void>());
  const sleep = runtimeEnv.sleepWithAbort;
  let index = 0;
  const spy = vi.spyOn(runtimeEnv, "sleepWithAbort").mockImplementation((...args) => {
    const pending = sleep(...args);
    entered[index]?.resolve();
    index += 1;
    return pending;
  });
  return { entered, restore: () => spy.mockRestore() };
}
