/** Hermes18d125cc lifecycle classifier, with guide46's explicit14/30-day thresholds. */
export type GardenerLifecycleState = "active" | "stale" | "archived";
export const GARDENER_REST_AFTER_DAYS = 14;
export const GARDENER_SET_ASIDE_AFTER_DAYS = 30;
export function planGardenerLifecycleState(input: {
  state: GardenerLifecycleState;
  managed: boolean;
  builtin: boolean;
  pinned: boolean;
  referencedByCron: boolean;
  createdAtMs: number | null;
  lastActivityAtMs: number | null;
  nowMs: number;
}): GardenerLifecycleState {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0)
    throw new Error("Invalid lifecycle clock.");
  if (!["active", "stale", "archived"].includes(input.state))
    throw new Error("Invalid lifecycle state.");
  if (
    !input.managed ||
    input.builtin ||
    input.pinned ||
    input.referencedByCron ||
    input.state === "archived"
  ) {
    return input.state;
  }
  const validTime = (value: number | null) =>
    value !== null && Number.isSafeInteger(value) && value >= 0;
  const anchor = validTime(input.lastActivityAtMs)
    ? input.lastActivityAtMs!
    : validTime(input.createdAtMs)
      ? input.createdAtMs!
      : input.nowMs;
  const age = input.nowMs - anchor;
  if (age >= GARDENER_SET_ASIDE_AFTER_DAYS * 86_400_000) return "archived";
  if (age >= GARDENER_REST_AFTER_DAYS * 86_400_000) return "stale";
  return "active";
}
