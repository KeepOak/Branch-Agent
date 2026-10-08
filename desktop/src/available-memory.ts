// Memory the OS can actually hand out for a second engine (candidate check / standby).
// os.freemem() is only unused pages: on macOS that leaves out inactive and purgeable
// memory, and on Linux it is MemFree rather than MemAvailable (#459). Windows
// ullAvailPhys is already the right figure, so it stays on os.freemem().
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";

/** 6 GB, the shared load rule. Tests replace it with BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB as an absolute MB floor. */
export const CANDIDATE_MIN_FREE_MB_DEFAULT = 6144;

export interface MemoryProbe {
  platform?: NodeJS.Platform;
  meminfo?: string;
  vmStat?: string;
  freemem?: number;
  totalmem?: number;
  /** When present, including `undefined`, this is the override; otherwise the process environment is read. */
  envMb?: string;
}

function pages(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function vmStat(probe: MemoryProbe): string {
  return probe.vmStat ?? execFileSync("/usr/bin/vm_stat", [], {
    encoding: "utf8", windowsHide: true, timeout: 3_000, stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Bytes the OS can give a new process now. */
export function availableMemoryBytes(probe: MemoryProbe = {}): number {
  const platform = probe.platform ?? process.platform;
  try {
    if (platform === "linux") {
      const available = /^MemAvailable:\s+(\d+)\s+kB$/mu.exec(probe.meminfo ?? readFileSync("/proc/meminfo", "utf8"))?.[1];
      const kib = pages(available);
      if (kib !== undefined) return kib * 1024;
    }
    if (platform === "darwin") {
      const text = vmStat(probe);
      const pageSize = pages(/page size of (\d+) bytes/u.exec(text)?.[1]);
      const free = pages(/^Pages free:\s+(\d+)\./mu.exec(text)?.[1]);
      const inactive = pages(/^Pages inactive:\s+(\d+)\./mu.exec(text)?.[1]);
      const purgeable = pages(/^Pages purgeable:\s+(\d+)\./mu.exec(text)?.[1]) ?? 0;
      if (pageSize !== undefined && free !== undefined && inactive !== undefined) {
        return (free + inactive + purgeable) * pageSize;
      }
    }
  } catch {
    // A failed probe must not block an update: fall back to os.freemem(), as before.
  }
  return probe.freemem ?? freemem();
}

/**
 * Floor for starting a second engine. BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB stays an absolute
 * megabyte override (#381). The default is 6 GB, but never more than a quarter of RAM, so a
 * 16 GB Mac with reclaimable cache still runs the candidate check.
 */
export function candidateMinFreeBytes(probe: MemoryProbe = {}): number {
  const env = Object.hasOwn(probe, "envMb") ? probe.envMb : process.env.BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB;
  if (env !== undefined) return Number(env) * 2 ** 20;
  return Math.min(CANDIDATE_MIN_FREE_MB_DEFAULT * 2 ** 20, Math.floor((probe.totalmem ?? totalmem()) / 4));
}
