export interface MemoryProbe {
  platform?: NodeJS.Platform;
  meminfo?: string;
  vmStat?: string;
  freemem?: number;
  totalmem?: number;
  envMb?: string;
}
export type MemoryMeasure = "vm_stat" | "MemAvailable" | "os.freemem";
export interface AvailableMemory {
  bytes: number;
  measure: MemoryMeasure;
}
export function availableMemory(probe?: MemoryProbe): AvailableMemory;
export function availableMemoryBytes(probe?: MemoryProbe): number;
export function defaultMemoryNeedBytes(defaultBytes: number, totalBytes?: number): number;
