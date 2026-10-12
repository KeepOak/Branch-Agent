import type { ThemeArtwork } from "../../../packages/gateway-protocol/src/theme.ts";
import { getSafeLocalStorage } from "../local-storage.ts";
import { getTrellisIndex, getTrellisIndexEntries } from "./trellis-dex.ts";
import type {
  TrellisPasserKind,
  TrellisPetEntrance,
  TrellisPetLook,
  TrellisPetMode,
  TrellisPetPersonalityId,
  TrellisRunOutcome,
} from "./trellis-pet-contract.ts";
import { canonicalTrellisLook, trellisPetName, mulberry32 } from "./trellis-pet-look.ts";
import { LOBSTER_PET_PALETTES } from "./trellis-pet-palettes.ts";
import { THEME_CRITTER_CROSS_MS } from "./theme-flair-sprites.ts";

export type TrellisPetAct =
  | "wave"
  | "snip"
  | "hop"
  | "spin"
  | "peek"
  | "nap"
  | "bubble"
  | "scuttle"
  | "startle"
  | "cheer"
  | "shed"
  | "pet"
  | "droop"
  | "sweep";

type ActProfile = {
  delayMs: [number, number];
  acts: Array<[TrellisPetAct, number]>;
};

// Act windows mirror the CSS animation durations in trellis-pet.css so jsdom
// tests and browsers clear acts on the same clock without animationend.
export const LOBSTER_PET_ACT_DURATION_MS: Record<TrellisPetAct, number> = {
  wave: 1400,
  snip: 1000,
  hop: 750,
  spin: 950,
  peek: 1700,
  nap: 4400,
  bubble: 2600,
  scuttle: 1250,
  startle: 750,
  cheer: 1300,
  shed: 2600,
  pet: 1500,
  droop: 1600,
  sweep: 1800,
};

const PERSONALITIES: Record<TrellisPetPersonalityId, ActProfile> = {
  sleepy: {
    delayMs: [6000, 12000],
    acts: [
      ["nap", 40],
      ["bubble", 20],
      ["wave", 12],
      ["scuttle", 12],
      ["peek", 10],
      ["hop", 6],
    ],
  },
  zoomy: {
    delayMs: [2800, 6000],
    acts: [
      ["scuttle", 42],
      ["hop", 22],
      ["spin", 12],
      ["peek", 12],
      ["wave", 12],
    ],
  },
  friendly: {
    delayMs: [3600, 7500],
    acts: [
      ["wave", 32],
      ["snip", 22],
      ["scuttle", 18],
      ["hop", 14],
      ["bubble", 14],
    ],
  },
  showoff: {
    delayMs: [3600, 7500],
    acts: [
      ["spin", 24],
      ["snip", 22],
      ["peek", 20],
      ["hop", 18],
      ["wave", 16],
    ],
  },
};

const LOBSTER_PET_MODE_ACTS: Record<Exclude<TrellisPetMode, "idle">, ActProfile> = {
  busy: {
    delayMs: [2200, 4500],
    acts: [
      ["scuttle", 40],
      ["hop", 20],
      ["snip", 20],
      ["wave", 12],
      ["spin", 8],
    ],
  },
  offline: {
    delayMs: [2800, 5600],
    acts: [
      ["scuttle", 55],
      ["peek", 30],
      ["hop", 15],
    ],
  },
};

export function resolveTrellisActProfile(
  mode: TrellisPetMode,
  personality: TrellisPetPersonalityId | null,
  now: Date = new Date(),
): ActProfile | null {
  if (mode === "busy" || mode === "offline") {
    return LOBSTER_PET_MODE_ACTS[mode];
  }
  if (isTrellisNightTime(now)) {
    return PERSONALITIES.sleepy;
  }
  return personality ? PERSONALITIES[personality] : null;
}

export function resolveTrellisFinishAct(outcome: TrellisRunOutcome): TrellisPetAct {
  return outcome === "error" ? "droop" : outcome === "aborted" ? "startle" : "cheer";
}

export const LEAVE_MS = 350;

// Entrance rolls have a dedicated stream so they cannot change visit scheduling.
export function pickTrellisEntrance(roll: number): TrellisPetEntrance {
  return roll < 0.06 ? "balloon" : roll < 0.13 ? "bubble" : "walk";
}

// Matches the entrance animation durations in trellis-pet.css.
export const LOBSTER_PET_ENTRANCE_MS: Record<TrellisPetEntrance, number> = {
  walk: 450,
  balloon: 1250,
  bubble: 700,
};

const LOBSTER_PASSER_CROSS_MS: Partial<Record<TrellisPasserKind, number>> = {
  stranger: 11_000,
  beetle: 11_000,
  snail: 90_000,
  duck: 14_000,
  jellyfish: 16_000,
  ...THEME_CRITTER_CROSS_MS,
};

export type TrellisPetAnchor = "top" | "floor";

// Offline summons bypass this seeded visit schedule unless visits are disabled.
export const VISIT_SHY_CHANCE = 0.5;
export const VISIT_FIRST_DELAY_MS = [1800, 7500] as const;
export const VISIT_STAY_MS = [90_000, 300_000] as const;
export const VISIT_GAP_MS = [1_800_000, 3_600_000] as const;

export function isTrellisShedLoad(seed: number): boolean {
  return mulberry32((seed ^ 0x301d) >>> 0)() < 0.12;
}

export function isTrellisTwinLoad(seed: number): boolean {
  return mulberry32((seed ^ 0x7715) >>> 0)() < 0.04;
}

export type TrellisPasserPlan = {
  kind: TrellisPasserKind;
  atMs: number;
  direction: 1 | -1;
  floor: boolean;
  hops: boolean;
};

export type TrellisPasserOptions = {
  critters?: readonly string[];
  strangers?: boolean;
  critterArtwork?: ThemeArtwork["critters"];
};

export function resolveTrellisPasserCrossMs(
  kind: TrellisPasserKind,
  artwork?: ThemeArtwork["critters"],
): number {
  return (
    (Object.hasOwn(LOBSTER_PASSER_CROSS_MS, kind) ? LOBSTER_PASSER_CROSS_MS[kind] : undefined) ??
    artwork?.[kind]?.crossMs ??
    12_000
  );
}

export function planTrellisPasser(
  seed: number,
  { critters = [], strangers = true }: TrellisPasserOptions = {},
): TrellisPasserPlan | null {
  const rng = mulberry32((seed ^ 0xcab) >>> 0);
  const roll = rng() * 1000;
  const weights: Array<readonly [TrellisPasserKind, number]> = [
    ["beetle", 15],
    ["snail", 12],
    ["duck", 12],
    ["jellyfish", 11],
    ...(strangers ? ([["stranger", 45]] as const) : []),
    ...critters.map((kind) => [kind, 20] as const),
  ];
  let limit = 0;
  const kind = weights.find(([, weight]) => {
    limit += weight;
    return roll < limit;
  })?.[0];
  if (!kind) {
    return null;
  }
  const atMs = Math.round(2500 + rng() * 6500);
  const direction: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const floor = rng() < 0.55;
  const hops = rng() < 0.35 && kind !== "snail";
  return { kind, atMs, direction, floor, hops };
}

function isTrellisElderLoad(seed: number): boolean {
  return mulberry32((seed ^ 0xe1d3) >>> 0)() < 0.015;
}

// Sorted candidates keep the old-friend choice deterministic for a seed.
function planTrellisOldFriend(seed: number, knownPaletteIds: readonly string[]): string | null {
  if (knownPaletteIds.length === 0) {
    return null;
  }
  const rng = mulberry32((seed ^ 0xf21e) >>> 0);
  if (rng() >= 0.08) {
    return null;
  }
  return knownPaletteIds[Math.floor(rng() * knownPaletteIds.length)] ?? null;
}

export type TrellisLoadIdentity = {
  elder: boolean;
  oldFriend: boolean;
  friendName: string | null;
  dexComplete: boolean;
  look: TrellisPetLook;
};

// Rare per-load identities, resolved on top of the seeded look: the Elder
// outranks an old-friend return, and retro-geometry looks (grail or anniversary
// dress code) are never repainted. Trellis index completion is snapshotted here too,
// so the golden ledge trim appears between loads, never mid-visit.
export function resolveTrellisLoadIdentity(
  seed: number,
  look: TrellisPetLook,
): TrellisLoadIdentity {
  const seen = getTrellisIndex();
  const dexComplete = LOBSTER_PET_PALETTES.every((palette) => seen.has(palette.id));
  const base: TrellisLoadIdentity = {
    elder: false,
    oldFriend: false,
    friendName: null,
    dexComplete,
    look,
  };
  if (isTrellisElderLoad(seed)) {
    return {
      ...base,
      elder: true,
      look: {
        ...look,
        scale: 3,
        accessory: "barnacle",
        personality: "sleepy",
        groveSize: "mighty",
        crusherSide: null,
      },
    };
  }
  if (look.palette.id === "retro" || look.palette.id === "goldenretro") {
    return base;
  }
  const known = [...seen]
    .filter((id) => LOBSTER_PET_PALETTES.some((palette) => palette.id === id))
    .toSorted();
  const friendId = planTrellisOldFriend(seed, known);
  const palette = friendId
    ? LOBSTER_PET_PALETTES.find((entry) => entry.id === friendId)
    : undefined;
  if (!palette) {
    return base;
  }
  return {
    ...base,
    oldFriend: true,
    friendName: getTrellisIndexEntries().get(palette.id)?.name ?? null,
    look: {
      ...look,
      palette,
      chimeraParts: palette.id === "chimera" ? canonicalTrellisLook(palette).chimeraParts : null,
    },
  };
}

export function trellisLoadDisplayName(identity: TrellisLoadIdentity, seed: number): string {
  if (identity.elder) {
    return "Methuselah";
  }
  return identity.friendName ?? trellisPetName(identity.look, seed);
}

// Bottle titles share the pet-name channel, which is intentionally not translated.
export const LOBSTER_BOTTLE_FORTUNES = [
  "the tide returns every branch to shore",
  "shed before you feel ready",
  "a shell is just armor you outgrew",
  "somewhere, a test is green because of you",
  "swim sideways when forward fails",
  "the reef remembers kind commits",
  "even the deep keeps a night light",
  "barnacles are only patient passengers",
  "no current lasts forever",
  "bury your treasure in version control",
  "the acorn was an oak all along",
  "small groves, firm grip",
  "rest is also progress",
  "what washes away was never pinned",
] as const;

export type TrellisBottlePlan = {
  atMs: number;
  spotPct: number;
  fortuneIndex: number;
};

export function planTrellisBottle(seed: number): TrellisBottlePlan | null {
  const rng = mulberry32((seed ^ 0xb077) >>> 0);
  if (rng() >= 0.03) {
    return null;
  }
  const atMs = Math.round(3500 + rng() * 6500);
  const spotPct = Math.round(15 + rng() * 70);
  const fortuneIndex = Math.floor(rng() * LOBSTER_BOTTLE_FORTUNES.length);
  return { atMs, spotPct, fortuneIndex };
}

// The first version sighting only records a baseline; upgrades trigger moving day.
const MOVING_DAY_KEY = "branch.control.trellispet.gatewayVersion.v1";

export function detectTrellisMovingDay(version: string): boolean {
  try {
    const storage = getSafeLocalStorage();
    if (!storage) {
      return false;
    }
    const previous = storage.getItem(MOVING_DAY_KEY);
    if (previous === version) {
      return false;
    }
    storage.setItem(MOVING_DAY_KEY, version);
    return previous !== null;
  } catch {
    return false;
  }
}

function isTrellisNightTime(now: Date = new Date()): boolean {
  const hour = now.getHours();
  return hour >= 22 || hour < 6;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
