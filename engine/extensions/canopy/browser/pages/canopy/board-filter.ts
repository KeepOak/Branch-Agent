import { t } from "../../i18n/index.ts";
import {
  matchesBoardFilter,
  canopyCardBoardId,
  CANOPY_ALL_BOARDS_FILTER,
} from "../../lib/canopy/board-filter.ts";
import { canopyBoardLabel } from "../../lib/canopy/board-presentation.ts";
import type { CanopyBoardSummary, CanopyCard } from "../../lib/canopy/index.ts";
import type { CanopySelectOption } from "./canopy-select.ts";

export { matchesBoardFilter, CANOPY_ALL_BOARDS_FILTER };

function boardDescription(board: CanopyBoardSummary): string {
  if (board.kind === "sessions") {
    return t("canopy.sessionsBoard.kind");
  }
  const params = { active: String(board.active), total: String(board.total) };
  return board.archivedAt
    ? t("canopy.boardFilterArchivedSummary", params)
    : t("canopy.boardFilterSummary", params);
}

export function buildBoardFilterOptions(
  boards: readonly CanopyBoardSummary[],
  cards: readonly CanopyCard[],
): CanopySelectOption[] {
  const uniqueBoards = new Map<string, CanopyBoardSummary>();
  for (const board of boards) {
    const id = board.id.trim();
    if (id && !uniqueBoards.has(id)) {
      uniqueBoards.set(id, {
        ...board,
        id,
        total: 0,
        active: 0,
        archived: 0,
        byStatus: {},
      });
    }
  }
  for (const card of cards) {
    const id = canopyCardBoardId(card);
    const board: CanopyBoardSummary = uniqueBoards.get(id) ?? {
      id,
      total: 0,
      active: 0,
      archived: 0,
      byStatus: {},
    };
    board.total += 1;
    if (card.metadata?.archivedAt) {
      board.archived += 1;
    } else {
      board.active += 1;
    }
    board.byStatus[card.status] = (board.byStatus[card.status] ?? 0) + 1;
    uniqueBoards.set(id, board);
  }
  const sortedBoards = [...uniqueBoards.values()].toSorted((left, right) => {
    if (left.id === "default") {
      return -1;
    }
    if (right.id === "default") {
      return 1;
    }
    return canopyBoardLabel(left).localeCompare(canopyBoardLabel(right));
  });
  return [
    { value: CANOPY_ALL_BOARDS_FILTER, label: t("canopy.allBoards") },
    ...sortedBoards.map((board) => ({
      value: board.id,
      label: canopyBoardLabel(board),
      description: boardDescription(board),
      boardId: board.id,
      icon: board.icon,
      color: board.color,
    })),
  ];
}
