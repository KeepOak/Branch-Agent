// Memory the OS can actually hand out for a second engine (candidate check / standby).
// os.freemem() is only unused pages: on macOS that leaves out inactive and purgeable
// memory, and on Linux it is MemFree rather than MemAvailable (#459). Windows
// ullAvailPhys is already the right figure, so it stays on os.freemem().
import { defaultMemoryNeedBytes, type MemoryMeasure, type MemoryProbe } from "./available-memory-core.mjs";
export { availableMemory, availableMemoryBytes, type AvailableMemory, type MemoryMeasure, type MemoryProbe } from "./available-memory-core.mjs";

/** 6 GB, the shared load rule. Tests replace it with BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB as an absolute MB floor. */
export const CANDIDATE_MIN_FREE_MB_DEFAULT = 6144;

/** Skip line written to desktop.log when there is not enough room for a second engine. */
export function candidateCheckSkippedLine(bytes: number, measure: MemoryMeasure): string {
  return `candidate check skipped; ${Math.round(bytes / 2 ** 20)} MB free (${measure})`;
}

/**
 * Floor for starting a second engine. BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB stays an absolute
 * megabyte override (#381). The default is 6 GB, but never more than a quarter of RAM, so a
 * 16 GB Mac with reclaimable cache still runs the candidate check.
 */
export function candidateMinFreeBytes(probe: MemoryProbe = {}): number {
  const env = Object.hasOwn(probe, "envMb") ? probe.envMb : process.env.BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB;
  if (env !== undefined) return Number(env) * 2 ** 20;
  return defaultMemoryNeedBytes(CANDIDATE_MIN_FREE_MB_DEFAULT * 2 ** 20, probe.totalmem);
}
