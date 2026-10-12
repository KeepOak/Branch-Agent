// Trunk permission defaults (atlas SAFETY-0214): new Trunks and rooms start on "Ask first", every surface uses the
// same mode words, and Trunks restored from a backup come back paused and look-only until the owner gives back
// what they had. Mode ids are the engine's session permission modes (session-permission-exec-mode.ts).
import type { PreparedSessionPermissionPolicy } from "../agents/tool-fs-policy.types.js";

export type PermissionMode = PreparedSessionPermissionPolicy["mode"];

/** One word per mode, the same everywhere (window composer MODE_ROWS uses these names). */
export const PERMISSION_MODE_WORDS: Readonly<Record<PermissionMode, string>> = Object.freeze({
  "read-only": "Read only",
  guarded: "Ask first",
  workspace: "Auto",
  full: "Full access",
});

export const NEW_TRUNK_PERMISSION_MODE: PermissionMode = "guarded";
export const NEW_ROOM_PERMISSION_MODE: PermissionMode = "guarded";

export function permissionModeWord(mode: PermissionMode): string {
  return PERMISSION_MODE_WORDS[mode];
}

/** The mode a newly created Trunk or room starts on. Nothing a creator passes can start it wider. */
export function initialPermissionMode(kind: "trunk" | "room"): PermissionMode {
  return kind === "room" ? NEW_ROOM_PERMISSION_MODE : NEW_TRUNK_PERMISSION_MODE;
}

export type TrunkAccess = Readonly<{
  mode: PermissionMode;
  toolsAllow?: readonly string[];
  schedulesEnabled: boolean;
}>;

export type RestoredTrunkState = Readonly<{
  paused: true;
  access: TrunkAccess;
  /** What it had before the backup, held until the owner gives it back. */
  heldAccess: TrunkAccess;
}>;

const LOOK_ONLY: TrunkAccess = Object.freeze({ mode: "read-only", schedulesEnabled: false });

/** A Trunk restored from a backup comes back paused and look-only. */
export function restoreTrunkFromBackup(saved: TrunkAccess): RestoredTrunkState {
  return Object.freeze({ paused: true, access: LOOK_ONLY, heldAccess: saved });
}

/** Only the owner can give the held access back. Anyone else leaves the Trunk paused and look-only. */
export function giveBackTrunkAccess(
  state: RestoredTrunkState,
  by: { owner: boolean },
): { paused: boolean; access: TrunkAccess } {
  if (!by.owner) {
    return { paused: state.paused, access: state.access };
  }
  return { paused: false, access: state.heldAccess };
}
