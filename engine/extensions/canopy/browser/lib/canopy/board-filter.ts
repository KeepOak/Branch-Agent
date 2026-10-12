import type { CanopyCard, CanopyUiState } from "./types.ts";

export const CANOPY_ALL_BOARDS_FILTER = "__all__";

export function canopyCardBoardId(card: CanopyCard): string {
  return card.metadata?.automation?.boardId?.trim() || "default";
}

export function matchesBoardFilter(
  card: CanopyCard,
  filter: CanopyUiState["boardFilter"],
): boolean {
  return filter === CANOPY_ALL_BOARDS_FILTER || canopyCardBoardId(card) === filter;
}
