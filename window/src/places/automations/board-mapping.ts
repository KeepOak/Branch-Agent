// Maps Canopy's nine card statuses onto Automations › Board's six columns
// (§4.6.3.5; preview COLS15 after the D18 orchard patch).

export type BoardCol = "sort" | "todo" | "doing" | "check" | "done" | "stuck";

export const BOARD_COLUMNS: [BoardCol, string][] = [
  ["sort", "To sort"], ["todo", "To do"], ["doing", "Doing"], ["check", "To check"], ["done", "Done"], ["stuck", "Stuck"],
];

const STATUS_COL: Record<string, BoardCol> = {
  triage: "sort",
  backlog: "todo",
  todo: "todo",
  scheduled: "todo",
  ready: "doing",
  running: "doing",
  review: "check",
  blocked: "stuck",
  done: "done",
};

const COL_STATUS: Record<BoardCol, string> = {
  sort: "triage",
  todo: "todo",
  doing: "running",
  check: "review",
  done: "done",
  stuck: "blocked",
};

export function statusToColumn(status: string): BoardCol | null {
  return STATUS_COL[status] ?? null;
}

/** The canopy.cards.move status that lands a card in this column. */
export function columnToStatus(col: BoardCol): string {
  return COL_STATUS[col];
}

export const colName = (col: BoardCol) => BOARD_COLUMNS.find(([k]) => k === col)?.[1] ?? col;
