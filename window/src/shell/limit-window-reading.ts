/** Missing quota is unknown. An explicitly measured zero is a full allowance. */
export function readMeasuredPercent(value: unknown): { used: number; left: number } | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const used = Math.min(100, Math.max(0, value));
  return { used, left: Math.round(100 - used) };
}
