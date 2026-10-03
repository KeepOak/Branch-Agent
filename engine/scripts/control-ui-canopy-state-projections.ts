import {
  getCardAlerts,
  type CardAlert,
} from "../extensions/canopy/browser/lib/canopy/card-alerts.ts";
import { getCanopyLifecycle } from "../extensions/canopy/browser/lib/canopy/lifecycle.ts";
import {
  getCanopyStateCell,
  CANOPY_STATE_LABELS,
} from "../ui/src/test-helpers/control-ui-canopy-states.ts";

/** Only the opt-in native fixture imports these projections. Persisted cards stay unchanged. */
export const getFixtureLifecycle: typeof getCanopyLifecycle = (card, sessions, resolution) => {
  const cell = getCanopyStateCell(card.id);
  if (cell?.state === "unavailable" || cell?.state === "ambiguous") {
    return { session: null, state: cell.state };
  }
  return getCanopyLifecycle(card, sessions, resolution);
};

export const getFixtureAlerts: typeof getCardAlerts = (card, lifecycle, dependencies, now) => {
  const original = getCardAlerts(card, lifecycle, dependencies, now);
  const cell = getCanopyStateCell(card.id);
  if (!cell) {
    return original;
  }
  if (cell.alert === "none") {
    return [];
  }
  if (cell.alert === "same") {
    const alert: CardAlert = {
      kind: "session",
      severity: "warning",
      title: CANOPY_STATE_LABELS[cell.state],
      timestamp: card.updatedAt,
      repeatsSessionState: cell.state === "blocked" ? "unlinked" : cell.state,
    };
    return [alert];
  }
  return [
    {
      kind: "diagnostic",
      severity: "warning",
      title: "Review the deployment evidence",
      detail: "Independent synthetic alert; not an execution-state summary.",
      timestamp: card.updatedAt,
    },
  ];
};
