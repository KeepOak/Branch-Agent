// Maps Canopy's nine card statuses to Board's six columns (§4.6.3.5, preview's Automations › Board).
// The Board's columns match the preview's 5-column design extended with "To sort" for triage work.

export type BoardCol = "sort" | "todo" | "doing" | "check" | "done" | "stuck";
export type CanopyStatus = "triage" | "backlog" | "todo" | "scheduled" | "ready" | "running" | "review" | "blocked" | "done";

/** Maps a Canopy status to a Board column. */
export function statusToColumn(status: CanopyStatus): BoardCol {
  switch (status) {
    case "triage": return "sort";
    case "backlog": return "todo";
    case "todo": return "todo";
    case "scheduled": return "todo";
    case "ready": return "doing";
    case "running": return "doing";
    case "review": return "check";
    case "blocked": return "stuck";
    case "done": return "done";
  }
}

/** Maps a Board column to a Canopy status, or returns null when no move method exists for that column. */
export function columnToStatus(col: BoardCol): CanopyStatus | null {
  switch (col) {
    case "sort": return "triage";
    case "todo": return "todo";
    case "doing": return "running";
    case "check": return "review";
    case "done": return "done";
    case "stuck": return "blocked";
  }
}

/** The reason a move to this column is disabled, or null when the move is allowed. */
export function moveDisabledReason(_col: BoardCol): string | null {
  // All columns have canopy.cards.move support via columnToStatus
  return null;
}
