import type { GatewaySessionRow } from "../../api/types.ts";
import { normalizeSessionKeyForUiComparison } from "../sessions/session-key.ts";
import { isFailedSessionStatus, staleSessionState, canopyCardSessionKey } from "./card-state.ts";
import { isReservedSessionKey } from "./session-links.ts";
import type { CanopySessionResolution } from "./session-resolution.ts";
import type { CanopyCard, CanopyLifecycle } from "./types.ts";

export function findCanopySession(
  card: CanopyCard,
  sessions: readonly GatewaySessionRow[],
  resolution?: CanopySessionResolution,
): GatewaySessionRow | null {
  const sessionKey = canopyCardSessionKey(card);
  if (!sessionKey || isReservedSessionKey(sessionKey)) {
    return null;
  }
  const key = normalizeSessionKeyForUiComparison(sessionKey);
  if (resolution?.key === key) {
    return resolution.status === "resolved" ? resolution.session : null;
  }
  // A filtered roster proves exact positive matches, never provisional uniqueness.
  return (
    sessions.find((session) => normalizeSessionKeyForUiComparison(session.key) === key) ?? null
  );
}

export function getCanopyLifecycle(
  card: CanopyCard,
  sessions: readonly GatewaySessionRow[],
  resolution?: CanopySessionResolution,
): CanopyLifecycle {
  const session = findCanopySession(card, sessions, resolution);
  if (!canopyCardSessionKey(card)) {
    return { session: null, state: "unlinked" };
  }
  if (!session) {
    const current =
      resolution?.key === normalizeSessionKeyForUiComparison(canopyCardSessionKey(card) ?? "");
    return {
      session: null,
      state:
        current && (resolution.status === "ambiguous" || resolution.status === "unavailable")
          ? resolution.status
          : "unknown",
    };
  }
  if (session.status === "queued") {
    return { session, state: "queued" };
  }
  if (staleSessionState(session)) {
    return { session, state: "stale" };
  }
  if (session.hasActiveRun === true || session.status === "running") {
    return { session, state: "running" };
  }
  if (session.abortedLastRun || isFailedSessionStatus(session.status)) {
    return { session, state: "failed" };
  }
  if (session.status === "done") {
    return { session, state: "succeeded" };
  }
  return { session, state: "idle" };
}
