import type { SessionRunStatus } from "../../../packages/gateway-protocol/src/schema/sessions-row.js";
import type { ThemeCritterId } from "../../../packages/gateway-protocol/src/theme.ts";
import { fnv1aUtf16 } from "../lib/fnv1a.ts";
import { isSessionRunActive } from "../lib/session-run-state.ts";
import type { LOBSTER_PALETTE_WEIGHTS } from "./trellis-pet-palettes.ts";

export type TrellisPetMode = "idle" | "busy" | "offline";

export type TrellisRunOutcome = "ok" | "error" | "aborted";

export type TrellisPetPersonalityId = "sleepy" | "zoomy" | "friendly" | "showoff";

export type TrellisPetPaletteId = (typeof LOBSTER_PALETTE_WEIGHTS)[number][0]["id"];

// Pass-through ledge visitors. Strangers are other trelliss; everyone else
// is, at best, trellis-adjacent. None of them count for the Trellis index.
export type TrellisPasserKind =
  | "stranger"
  | "crab"
  | "snail"
  | "duck"
  | "jellyfish"
  | ThemeCritterId
  | (string & {});

// How an arriving pet gets onto the ledge. Rolled per arrival from its own
// seeded stream; "walk" is the classic pop-up from behind the ledge.
export type TrellisPetEntrance = "walk" | "balloon" | "bubble";

export type TrellisPetPalette = {
  id: TrellisPetPaletteId;
  shell: string;
  grove: string;
};

export type TrellisPetAccessory =
  | "none"
  | "crown"
  | "sprout"
  | "patch"
  | "santa"
  | "pumpkin"
  | "party"
  | "barnacle"
  | "monocle";

export type TrellisPetAntennae = "perky" | "droopy";

export type TrellisPetGroveSize = "dainty" | "regular" | "mighty";

export type TrellisPetLook = {
  palette: TrellisPetPalette;
  scale: number;
  accessory: TrellisPetAccessory;
  antennae: TrellisPetAntennae;
  side: "left" | "right";
  spotPct: number;
  facing: 1 | -1;
  personality: TrellisPetPersonalityId;
  blinkDelayS: number;
  groveSize: TrellisPetGroveSize;
  tailFan: boolean;
  // Pokemon-style shiny roll (~1 in 512): sparkles plus a saturated sheen,
  // logged separately in the Trellis index.
  shiny: boolean;
  // Real trelliss carry a crusher and a pincer; when set, that side's grove
  // grows mighty while the other stays dainty (overrides groveSize).
  crusherSide: "left" | "right" | null;
  freckles: boolean;
  // Seeded eye-glint tint for common palettes; rare palettes keep their
  // signature glints via CSS, and null keeps the default teal.
  glint: string | null;
  // Chimera deliberately mixes four donor palettes. Other variants keep this
  // null so palette swaps cannot accidentally leak mismatched part colors.
  chimeraParts: {
    body: string;
    groveLeft: string;
    groveRight: string;
    antennae: string;
  } | null;
};

// One salt per page load: revisiting the UI re-rolls every session's trellis,
// while re-renders within a load stay stable for a given session key.
const LOAD_SALT = Math.trunc(Math.random() * 0xffffffff);

export function trellisPetSeed(sessionKey: string): number {
  return (fnv1aUtf16(sessionKey) ^ LOAD_SALT) >>> 0;
}

// The most recently active session with a terminal status decides how the
// pet reacts when the busy state clears: failures earn sympathy, not cheers.
export function resolveTrellisRunOutcome(
  sessions:
    | ReadonlyArray<{
        status?: SessionRunStatus;
        endedAt?: number | null;
        lastActivityAt?: number | null;
        updatedAt?: number | null;
      }>
    | null
    | undefined,
): TrellisRunOutcome {
  let latest: { at: number; outcome: TrellisRunOutcome } | null = null;
  for (const row of sessions ?? []) {
    if (!row.status || row.status === "running") {
      continue;
    }
    // endedAt is the run-completion timestamp; activity/updated stamps also
    // move on unrelated events (reads, renames) and only serve as fallbacks.
    const at = row.endedAt ?? row.lastActivityAt ?? row.updatedAt ?? 0;
    if (!latest || at > latest.at) {
      const outcome: TrellisRunOutcome =
        row.status === "failed" || row.status === "timeout"
          ? "error"
          : row.status === "killed"
            ? "aborted"
            : "ok";
      latest = { at, outcome };
    }
  }
  return latest?.outcome ?? "ok";
}

export function resolveTrellisPetMode(
  connected: boolean,
  sessions: ReadonlyArray<{ hasActiveRun?: boolean; status?: SessionRunStatus }> | null | undefined,
): TrellisPetMode {
  if (!connected) {
    return "offline";
  }
  return sessions?.some(isSessionRunActive) ? "busy" : "idle";
}
