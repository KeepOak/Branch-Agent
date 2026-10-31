export interface MemoryProbe {
  platform?: NodeJS.Platform;
  meminfo?: string;
  vmStat?: string;
  /** Windows Available Bytes as the counter prints it; tests inject it instead of a refresh. */
  windowsAvailable?: string;
  /** Clock for the age of the last Windows reading, in ms. */
  now?: number;
  /** Oldest Windows reading to trust, in ms (default WINDOWS_AVAILABLE_MAX_AGE_MS). */
  maxAgeMs?: number;
  freemem?: number;
  totalmem?: number;
  envMb?: string;
}
export type MemoryMeasure = "vm_stat" | "MemAvailable" | "AvailableBytes" | "os.freemem";
export interface WindowsAvailableRefresh {
  platform?: NodeJS.Platform;
  now?: () => number;
  /** Reuse a reading or failed read younger than this, in ms (default WINDOWS_AVAILABLE_MAX_AGE_MS). */
  maxAgeMs?: number;
  /** Replaces the PowerShell counter query (tests). */
  query?: () => string | Promise<string>;
}
export const WINDOWS_AVAILABLE_MAX_AGE_MS: number;
export function refreshWindowsAvailableMemory(
  options?: WindowsAvailableRefresh,
): Promise<number | undefined>;
export interface AvailableMemory {
  bytes: number;
  measure: MemoryMeasure;
}
export function availableMemory(probe?: MemoryProbe): AvailableMemory;
export function availableMemoryBytes(probe?: MemoryProbe): number;
export function defaultMemoryNeedBytes(defaultBytes: number, totalBytes?: number): number;
export function defaultHeavyStepMemoryNeedBytes(
  defaultBytes: number,
  totalBytes?: number,
  platform?: NodeJS.Platform,
): number;
