import type { BoardGetParams } from "@branch/gateway-protocol";
import type {
  ControlUiHost,
  ControlUiSessionListResult,
  ControlUiSessionListSubscription,
} from "branch/plugin-sdk/control-ui";
import type { GatewaySessionRow } from "../../api/types.ts";
import { formatUiError } from "../format-error.ts";
import { normalizeSessionKeyForUiComparison } from "../sessions/session-key.ts";
import { canopyCardSessionKey } from "./card-state.ts";
import { isReservedSessionKey, canopySessionKeyMatches } from "./session-links.ts";
import type { CanopyCard } from "./types.ts";

export type CanopySessionResolution =
  | { key: string; status: "resolved"; session: GatewaySessionRow }
  | {
      key: string;
      status: "unknown" | "unavailable" | "ambiguous";
      candidates?: readonly GatewaySessionRow[];
      error?: string;
    };

export function canopyCardSessionTarget(
  card: CanopyCard,
  session?: BoardGetParams,
): BoardGetParams | undefined {
  const key = session?.sessionKey ?? canopyCardSessionKey(card);
  // Provisional links need a resolved key; reserved keys also need an explicit owner.
  // The card's current assignee does not identify the original execution.
  if (
    !key ||
    key.toLowerCase().startsWith("subagent:canopy-") ||
    (isReservedSessionKey(key) && !session?.agentId)
  ) {
    return undefined;
  }
  return session ?? { sessionKey: key };
}

function resolveSession(
  key: string,
  result: ControlUiSessionListResult,
): CanopySessionResolution {
  const exact = result.sessions.find(
    (session) => normalizeSessionKeyForUiComparison(session.key) === key,
  );
  if (exact) {
    return { key, status: "resolved", session: exact };
  }
  const candidates = result.sessions.filter((session) =>
    canopySessionKeyMatches(session.key, key),
  );
  if (candidates.length > 1) {
    return { key, status: "ambiguous", candidates };
  }
  // Pending deletions can hide rows without changing pagination metadata.
  // Neither that gap nor a partial page establishes a provisional link's owner.
  if (result.hasMore !== false || (result.totalCount ?? 0) > result.sessions.length) {
    return { key, status: "unknown", candidates };
  }
  const session = candidates[0];
  return session ? { key, status: "resolved", session } : { key, status: "unavailable" };
}

/** One open card owns one bounded lookup; the sidebar is not a session directory. */
export function createCanopySessionResolver(host: ControlUiHost, notify: () => void) {
  let key = "";
  let active = false;
  let disposed = false;
  let subscription: ControlUiSessionListSubscription | undefined;
  let resolution: CanopySessionResolution | undefined;

  return {
    get resolution() {
      return resolution;
    },
    sync(sessionKey: string | undefined, enabled: boolean) {
      const nextKey = normalizeSessionKeyForUiComparison(sessionKey ?? "");
      if (disposed || (key === nextKey && active === enabled)) {
        return;
      }
      subscription?.dispose();
      subscription = undefined;
      key = nextKey;
      active = enabled;
      const reserved = isReservedSessionKey(key);
      resolution = key ? { key, status: reserved ? "ambiguous" : "unknown" } : undefined;
      if (!active || !key || reserved) {
        return;
      }
      try {
        subscription = host.sessions.observe(
          {
            search: key,
            archived: "all",
            limit: 2,
            configuredAgentsOnly: false,
            includeGlobal: false,
            includeUnknown: false,
            includeDerivedTitles: false,
            includeLastMessage: false,
          },
          ({ result, error }) => {
            resolution =
              result && !error
                ? resolveSession(key, result)
                : {
                    key,
                    status: "unknown",
                    ...(error ? { error } : {}),
                    candidates: result?.sessions.filter((session) =>
                      canopySessionKeyMatches(session.key, key),
                    ),
                  };
            notify();
          },
        );
      } catch (error) {
        resolution = { key, status: "unknown", error: formatUiError(error) };
        notify();
      }
    },
    refresh() {
      const current = subscription;
      if (current) {
        void current.refresh().catch((error: unknown) => {
          if (!disposed && subscription === current) {
            resolution = {
              key,
              status: "unknown",
              candidates:
                resolution?.status === "resolved" ? [resolution.session] : resolution?.candidates,
              error: formatUiError(error),
            };
            notify();
          }
        });
      }
    },
    dispose() {
      disposed = true;
      subscription?.dispose();
      subscription = undefined;
    },
  };
}
