// Uses the available-memory probe from desktop/src/available-memory.ts.
// Unused pages alone omit reclaimable cache on macOS and Linux.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { freemem } from "node:os";

export interface MemoryProbe {
  platform?: NodeJS.Platform;
  meminfo?: string;
  vmStat?: string;
  freemem?: number;
}

function pages(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Bytes the OS can give a new process, including reclaimable cache. */
export function availableMemoryBytes(probe: MemoryProbe = {}): number {
  const platform = probe.platform ?? process.platform;
  try {
    if (platform === "linux") {
      const available = /^MemAvailable:\s+(\d+)\s+kB$/mu.exec(
        probe.meminfo ?? readFileSync("/proc/meminfo", "utf8"),
      )?.[1];
      const kib = pages(available);
      if (kib !== undefined) return kib * 1024;
    }
    if (platform === "darwin") {
      const text =
        probe.vmStat ??
        execFileSync("/usr/bin/vm_stat", [], {
          encoding: "utf8",
          windowsHide: true,
          timeout: 3_000,
          stdio: ["ignore", "pipe", "ignore"],
        });
      const pageSize = pages(/page size of (\d+) bytes/u.exec(text)?.[1]);
      const free = pages(/^Pages free:\s+(\d+)\./mu.exec(text)?.[1]);
      const inactive = pages(/^Pages inactive:\s+(\d+)\./mu.exec(text)?.[1]);
      const purgeable = pages(/^Pages purgeable:\s+(\d+)\./mu.exec(text)?.[1]) ?? 0;
      if (pageSize !== undefined && free !== undefined && inactive !== undefined) {
        return (free + inactive + purgeable) * pageSize;
      }
    }
  } catch {
    // Preserve the desktop probe's behavior when an OS counter is unavailable.
  }
  return probe.freemem ?? freemem();
}
