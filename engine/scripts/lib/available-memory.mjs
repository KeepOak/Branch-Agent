// Shared desktop/admission probe: reclaimable cache is available memory (#459).
// Windows os.freemem() leaves out standby, so the update gate reads FreePhysicalMemory (#1054).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";

const WINDOWS_AVAILABLE_TIMEOUT_MS = 3_000;
// Admission waits poll this probe twice a second. Reuse a reading for a few seconds.
const WINDOWS_AVAILABLE_CACHE_MS = 5_000;
let windowsAvailableCache;

function pages(value) {
  if (value === undefined) {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

// Win32_OperatingSystem.FreePhysicalMemory is kilobytes Windows can hand out, standby included.
function windowsAvailableBytes(text) {
  const kib = pages(/^\s*(\d+)\s*$/mu.exec(String(text))?.[1]);
  return kib === undefined ? undefined : kib * 1024;
}

function readWindowsAvailable(probe) {
  if (typeof probe.readWindowsAvailable === "function") return probe.readWindowsAvailable();
  if (typeof probe.windowsAvailable === "string") return probe.windowsAvailable;
  // A unit test that only names the platform must not start PowerShell.
  if (probe.platform !== undefined) return undefined;
  const now = Date.now();
  if (windowsAvailableCache && now - windowsAvailableCache.at < WINDOWS_AVAILABLE_CACHE_MS) {
    if (windowsAvailableCache.error) throw windowsAvailableCache.error;
    return windowsAvailableCache.text;
  }
  try {
    const text = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "([uint64](Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory).ToString([cultureinfo]::InvariantCulture)",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: WINDOWS_AVAILABLE_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    windowsAvailableCache = { at: now, text };
    return text;
  } catch (error) {
    windowsAvailableCache = { at: now, error };
    throw error;
  }
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
    if (platform === "win32") {
      const text = readWindowsAvailable(probe);
      const bytes = text == null || text === "" ? undefined : windowsAvailableBytes(text);
      if (bytes !== undefined) return { bytes, measure: "available memory" };
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
