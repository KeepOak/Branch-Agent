/** How full this computer's memory is. The status chip and its popover share these bands. */
export type MemoryTone = "ok" | "warn" | "bad";

const GB = 1024 ** 3;
/** Bytes as gigabytes for the chip and popover, without a trailing ".0". */
export const gigabytes = (bytes: number): string => (bytes / GB).toFixed(1).replace(/\.0$/, "");

/** Under 90% used is ok, above 90% is warn, and 95% or more is bad. */
export function memoryTone(used: number, total: number): MemoryTone {
  if (total <= 0) return "ok";
  const share = used / total;
  if (share >= 0.95) return "bad";
  return share > 0.9 ? "warn" : "ok";
}
