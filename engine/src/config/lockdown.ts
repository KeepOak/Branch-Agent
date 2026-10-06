import { loadConfig } from "./io.js";

/** Lockdown is global and deliberately refuses work if its state cannot be read. */
export function isLockdownOn(): boolean {
  return loadConfig().security?.lockdown === true;
}

export function assertLockdownOff(): void {
  if (isLockdownOn()) {
    throw new Error("Lockdown is on: Trunks cannot run or send anything.");
  }
}
