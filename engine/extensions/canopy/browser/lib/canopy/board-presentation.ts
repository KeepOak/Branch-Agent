import { t } from "../../i18n/index.ts";
import type { CanopyBoardSummary } from "./types.ts";

export function canopyBoardName(board: Pick<CanopyBoardSummary, "id" | "name">): string {
  const name = board.name?.trim();
  return name || (board.id === "default" ? t("canopy.defaultBoard") : board.id);
}

export function canopyBoardLabel(board: Pick<CanopyBoardSummary, "id" | "name">): string {
  const explicitName = board.name?.trim();
  return explicitName && explicitName !== board.id
    ? `${explicitName} (${board.id})`
    : canopyBoardName(board);
}
