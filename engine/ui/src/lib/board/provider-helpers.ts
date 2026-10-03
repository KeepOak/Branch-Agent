import type { BoardSnapshot } from "@branch/gateway-protocol";
import { truncateCodePoints } from "@branch/normalization-core/code-points";

export function emptyBoardSnapshot(sessionKey: string): BoardSnapshot {
  return { sessionKey, revision: 0, tabs: [], widgets: [] };
}

export function normalizeBoardWidgetTitle(title: string | undefined): string | undefined {
  const normalized = title?.trim() ?? "";
  return normalized ? truncateCodePoints(normalized, 80) : undefined;
}
