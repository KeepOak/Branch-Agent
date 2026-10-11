// Shared desktop/admission probe: reclaimable cache is available memory (#459).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";

function pages(value) {
  if (value === undefined) {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function availableMemory(probe = {}) {
  const platform = probe.platform ?? process.platform;
  try {
    if (platform === "linux") {
      const available = /^MemAvailable:\s+(\d+)\s+kB$/mu.exec(
        probe.meminfo ?? readFileSync("/proc/meminfo", "utf8"),
      )?.[1];
      const kib = pages(available);
      if (kib !== undefined) {
        return { bytes: kib * 1024, measure: "MemAvailable" };
      }
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
        return { bytes: (free + inactive + purgeable) * pageSize, measure: "vm_stat" };
      }
    }
  } catch {
    // Preserve the desktop probe's existing behavior when an OS counter is unavailable.
  }
  return { bytes: probe.freemem ?? freemem(), measure: "os.freemem" };
}

export function availableMemoryBytes(probe = {}) {
  return availableMemory(probe).bytes;
}

// The desktop's existing default-load rule; explicit settings remain absolute.
export function defaultMemoryNeedBytes(defaultBytes, totalBytes = totalmem()) {
  return Math.min(defaultBytes, Math.floor(totalBytes / 4));
}
