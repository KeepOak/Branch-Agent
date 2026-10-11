// The permission mode for one conversation (DESIGN-SPEC §4.3.4; DECISIONS.md items 41, 42, 128).
// Engine modes are sessions.patch permissionMode: read-only, guarded, workspace, full; null is "As set".
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
export type EngineMode = "read-only" | "guarded" | "workspace" | "full";

export type ModeRow = {
  /** The engine's id, or null for a Branch mode the engine does not have. */
  engine: EngineMode | null;
  name: string;
  icon: "spark" | "shield" | "plan" | "eye" | "unlock";
  line: string;
  /** Why the row can't be picked, when the engine has no such mode. */
  gap?: string;
};

export const MODE_ROWS: readonly ModeRow[] = [
  {
    engine: "workspace",
    name: "Auto",
    icon: "spark",
    line: "Reads and changes files in the project folder. A reviewer model decides on commands that go further: it allows them, refuses them or asks you.",
  },
  {
    engine: "guarded",
    name: "Ask first",
    icon: "shield",
    line: "Reads and changes files in the project folder. Commands that go further wait for your yes, unless they are on the allowed list.",
  },
  {
    engine: null,
    name: "Plan first",
    icon: "plan",
    line: "Writes a plan and waits for your OK before doing anything.",
    gap: "Plan first isn't available with this version of Branch.",
  },
  {
    engine: "read-only",
    name: "Read only",
    icon: "eye",
    line: "Reads files in the project folder, but never changes them or runs commands.",
  },
  {
    engine: "full",
    name: "Full access",
    icon: "unlock",
    line: "Does anything on this computer without asking: files, commands, the internet. Seeing the screen and using the mouse is a separate switch in Settings › Computer & browser.",
  },
];

export const FULL_ACCESS_BLOCKED = "Only the owner can give full access. People on this computer and chat apps never can.";

export function modeName(mode: EngineMode | null | undefined): string {
  return mode ? (MODE_ROWS.find((row) => row.engine === mode)?.name ?? "") : "";
}

export function isEngineMode(v: unknown): v is EngineMode {
  return v === "read-only" || v === "guarded" || v === "workspace" || v === "full";
}

/** Why a row can't be picked here, or null when it can. */
export function blockedReason(row: ModeRow, canSelectFull: boolean): string | null {
  if (row.gap) {
    return row.gap;
  }
  return row.engine === "full" && !canSelectFull ? FULL_ACCESS_BLOCKED : null;
}

/** Shift+Tab: the next pickable mode after the one in effect, never landing on a blocked one (§4.3.4 rule 5). */
export function nextMode(current: EngineMode | null | undefined, canSelectFull: boolean): EngineMode | null {
  const usable = MODE_ROWS.filter((row) => !blockedReason(row, canSelectFull)).map((row) => row.engine as EngineMode);
  if (usable.length === 0) {
    return null;
  }
  const at = current ? usable.indexOf(current) : -1;
  return usable[(at + 1) % usable.length];
}
