/** The preview's first-use note on the browser stage (`S.stageNoteT5` / `branch-stage-note-t5`). */
export const STAGE_NOTE_KEY = "branch-stage-note-t5";

/** How the Trunk reads the page (the preview's `B18.mode`, default `both`). */
export const READ_MODES = [
  ["page", "Page"],
  ["picture", "Picture"],
  ["both", "Both"],
] as const;
export type ReadMode = (typeof READ_MODES)[number][0];
export const DEFAULT_READ_MODE: ReadMode = "both";

/** Who has the page: the Trunk (watch), you (drive), or neither. */
export type DriveMode = "watch" | "drive" | "idle";

export function driveMode(running: boolean, control: boolean): DriveMode {
  if (control) return "drive";
  if (running) return "watch";
  return "idle";
}

export function readStageNoteSeen(): boolean {
  try {
    return localStorage.getItem(STAGE_NOTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveStageNoteSeen(): void {
  try {
    localStorage.setItem(STAGE_NOTE_KEY, "1");
  } catch {
    // storage blocked: dismissed for this window only
  }
}
