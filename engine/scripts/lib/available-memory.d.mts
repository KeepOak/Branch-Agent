export interface MemoryProbe {
  platform?: NodeJS.Platform;
  meminfo?: string;
  vmStat?: string;
  /** Kilobytes from Win32_OperatingSystem.FreePhysicalMemory, for tests. */
  windowsAvailable?: string;
  /** Test double for the Windows available-memory read. */
  readWindowsAvailable?: () => string;
  freemem?: number;
  totalmem?: number;
  envMb?: string;
}
export type MemoryMeasure = "vm_stat" | "MemAvailable" | "os.freemem" | "available memory";
export interface AvailableMemory {
  bytes: number;
  measure: MemoryMeasure;
}
export function availableMemory(probe?: MemoryProbe): AvailableMemory;
export function availableMemoryBytes(probe?: MemoryProbe): number;
export function defaultMemoryNeedBytes(defaultBytes: number, totalBytes?: number): number;
