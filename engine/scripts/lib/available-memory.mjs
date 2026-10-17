// Shared desktop/admission probe: reclaimable cache is available memory (#459).
// Windows: the Memory "Available Bytes" counter is free, zeroed and standby pages, the
// figure Task Manager calls Available (Private #1054). Reading it starts PowerShell, so
// it is refreshed asynchronously and availableMemory() uses the last fresh reading.
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";

function pages(value) {
  if (value === undefined) {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * A refresh reuses a reading (or a failed read) this recent, and a gate trusts a reading
 * this long, so a caller polling every few seconds starts PowerShell at most once a minute.
 * A caller may pass a longer maxAgeMs (the desktop health poll uses 5 minutes).
 */
export const WINDOWS_AVAILABLE_MAX_AGE_MS = 60_000;
const WINDOWS_AVAILABLE_TIMEOUT_MS = 5_000;
const WINDOWS_AVAILABLE_QUERY = "(Get-CimInstance Win32_PerfRawData_PerfOS_Memory).AvailableBytes";
let windowsReading;
let windowsRefresh;

function windowsAvailableBytes(text) {
  return pages(/^\s*(\d+)\s*$/u.exec(String(text ?? ""))?.[1]);
}

function queryWindowsAvailable() {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_AVAILABLE_QUERY],
      { encoding: "utf8", windowsHide: true, timeout: WINDOWS_AVAILABLE_TIMEOUT_MS },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/**
 * Refresh the Windows Available Bytes reading without blocking the caller's event loop.
 * Resolves to the bytes, or undefined off Windows or when the counter cannot be read
 * (availableMemory() then falls back to os.freemem()). Concurrent calls share one query,
 * and a reading or failure younger than maxAgeMs is reused without a new query.
 */
export function refreshWindowsAvailableMemory(options = {}) {
  if ((options.platform ?? process.platform) !== "win32") {
    return Promise.resolve(undefined);
  }
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? WINDOWS_AVAILABLE_MAX_AGE_MS;
  if (windowsReading && now() - windowsReading.at < maxAgeMs) {
    return Promise.resolve(windowsReading.bytes);
  }
  windowsRefresh ??= Promise.resolve()
    .then(options.query ?? queryWindowsAvailable)
    .then(
      (text) => {
        const bytes = windowsAvailableBytes(text);
        windowsReading = { bytes, at: now() };
        return bytes;
      },
      () => {
        windowsReading = { bytes: undefined, at: now() };
        return undefined;
      },
    )
    .finally(() => {
      windowsRefresh = undefined;
    });
  return windowsRefresh;
}

export function availableMemory(probe = {}) {
  const platform = probe.platform ?? process.platform;
  if (platform === "win32") {
    const injected = probe.windowsAvailable !== undefined;
    const bytes = injected
      ? windowsAvailableBytes(probe.windowsAvailable)
      : windowsReading &&
          (probe.now ?? Date.now()) - windowsReading.at <
            (probe.maxAgeMs ?? WINDOWS_AVAILABLE_MAX_AGE_MS)
        ? windowsReading.bytes
        : undefined;
    if (bytes !== undefined) {
      return { bytes, measure: "AvailableBytes" };
    }
  }
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
      // macOS counts memory the way XNU's memorystatus does on a Mac with the compressor:
      // free + speculative + inactive + active pages (kern.memorystatus_level, the figure
      // memory_pressure prints as "System-wide memory free percentage"). vm_stat fields used:
      // "Pages free" (already excludes speculative), "Pages speculative", "Pages inactive",
      // "Pages active" (compressor-reclaimable: the compressor or file cache can take them
      // back) and "Pages purgeable". Purgeable pages sit on the active and inactive queues,
      // so they are added only when vm_stat has no "Pages active" line. Wired pages and
      // pages already held by the compressor are never available.
      const count = (field) =>
        pages(new RegExp(String.raw`^Pages ${field}:\s+(\d+)\.`, "mu").exec(text)?.[1]);
      const pageSize = pages(/page size of (\d+) bytes/u.exec(text)?.[1]);
      const free = count("free");
      const inactive = count("inactive");
      const speculative = count("speculative") ?? 0;
      const active = count("active");
      const reclaimable = active ?? count("purgeable") ?? 0;
      if (pageSize !== undefined && free !== undefined && inactive !== undefined) {
        return {
          bytes: (free + speculative + inactive + reclaimable) * pageSize,
          measure: "vm_stat",
        };
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

const GIB = 1024 ** 3;

/**
 * Default heavy-step need. A Mac with 16 GB of RAM or less needs a quarter of RAM, at most
 * 4 GB and at least 2 GB; larger Macs, Linux and Windows keep the shared load rule.
 */
export function defaultHeavyStepMemoryNeedBytes(
  defaultBytes,
  totalBytes = totalmem(),
  platform = process.platform,
) {
  if (platform === "darwin" && totalBytes <= 16 * GIB) {
    return Math.max(2 * GIB, Math.min(defaultBytes, 4 * GIB, Math.floor(totalBytes / 4)));
  }
  return defaultMemoryNeedBytes(defaultBytes, totalBytes);
}
