/** Guest-callable host functions for the QuickJS Code Mode worker. */
import { randomBytes } from "node:crypto";
import { CODE_MODE_RANDOM_VALUES_MAX_BYTES } from "branch/plugin-sdk/code-mode-executor-runtime";
import type { HostFunction, JSValueHandle, QuickJS } from "quickjs-wasi";

/**
 * Host callbacks never throw across the boundary: quickjs-wasi would copy the
 * host error (and its host stack) into the guest. The failure goes to
 * `recordFailure` for the run loop and the guest receives null, which the
 * controller turns into its own guest-realm error.
 */
export function guardHostCallback(
  vm: QuickJS,
  callback: HostFunction,
  recordFailure: (error: Error) => void,
): HostFunction {
  return function (this: JSValueHandle, ...args: JSValueHandle[]) {
    try {
      return Reflect.apply(callback, this, args);
    } catch (error) {
      recordFailure(error instanceof Error ? error : new Error("code mode host callback failed"));
      return vm.null;
    }
  };
}

/**
 * Backs guest `crypto`; only a hex string of host random bytes crosses into the VM.
 * A bad count gets the null sentinel and the guest throws its own error.
 */
export function createHostRandomHexHandler(vm: QuickJS): HostFunction {
  return (lengthHandle) => {
    const length: unknown = lengthHandle?.isNumber ? vm.dump(lengthHandle) : undefined;
    if (
      typeof length !== "number" ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > CODE_MODE_RANDOM_VALUES_MAX_BYTES
    ) {
      return vm.null;
    }
    return vm.newString(randomBytes(length).toString("hex"));
  };
}
