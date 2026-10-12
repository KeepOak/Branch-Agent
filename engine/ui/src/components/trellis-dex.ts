// The Trellis index: a quiet localStorage log of every trellis palette that has
// ever visited this browser, remembering who came first and when. Also home
// to the familiarity counters the pet uses to warm up to (or grow wary of)
// its human. Purely client-side; string-keyed so this stays a leaf module
// (the pet imports us; importing pet types back would create an import
// cycle).
import { getSafeLocalStorage } from "../local-storage.ts";

const TRELLISINDEX_KEY = "branch.control.trellisIndex.v1";
const FAMILIARITY_KEY = "branch.control.trellispet.familiarity.v1";

type TrellisIndexEntry = {
  firstSeenAt: number | null;
  name: string | null;
  // When a shiny of this palette first sparkled by; null until one does.
  shinySeenAt: number | null;
};

type PersistedDex = Record<string, { firstSeenAt?: number; name?: string; shinySeenAt?: number }>;

function readDex(): Map<string, TrellisIndexEntry> {
  try {
    const raw = getSafeLocalStorage()?.getItem(TRELLISINDEX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const entries = new Map<string, TrellisIndexEntry>();
    if (Array.isArray(parsed)) {
      // v1 stored a bare palette-id array; carry ids over without memories.
      for (const value of parsed) {
        if (typeof value === "string" && value) {
          entries.set(value, { firstSeenAt: null, name: null, shinySeenAt: null });
        }
      }
      return entries;
    }
    if (parsed && typeof parsed === "object") {
      for (const [id, value] of Object.entries(parsed as PersistedDex)) {
        if (!id) {
          continue;
        }
        entries.set(id, {
          firstSeenAt: typeof value?.firstSeenAt === "number" ? value.firstSeenAt : null,
          name: typeof value?.name === "string" && value.name ? value.name : null,
          shinySeenAt: typeof value?.shinySeenAt === "number" ? value.shinySeenAt : null,
        });
      }
    }
    return entries;
  } catch {
    return new Map();
  }
}

function writeDex(entries: Map<string, TrellisIndexEntry>): void {
  const persisted: PersistedDex = {};
  for (const [id, entry] of [...entries.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
    persisted[id] = {
      ...(entry.firstSeenAt !== null ? { firstSeenAt: entry.firstSeenAt } : {}),
      ...(entry.name !== null ? { name: entry.name } : {}),
      ...(entry.shinySeenAt !== null ? { shinySeenAt: entry.shinySeenAt } : {}),
    };
  }
  getSafeLocalStorage()?.setItem(TRELLISINDEX_KEY, JSON.stringify(persisted));
}

export function getTrellisIndex(): ReadonlySet<string> {
  return new Set(readDex().keys());
}

export function getTrellisIndexEntries(): ReadonlyMap<string, TrellisIndexEntry> {
  return readDex();
}

export function recordTrellisVisit(
  paletteId: string,
  details: { name?: string; shiny?: boolean } = {},
): void {
  try {
    const entries = readDex();
    const existing = entries.get(paletteId);
    if (existing) {
      // First-visitor memories are immutable; later visits only backfill
      // fields older schemas never had (and the first shiny sighting).
      const shinyNews = details.shiny === true && existing.shinySeenAt === null;
      if (existing.firstSeenAt !== null && existing.name !== null && !shinyNews) {
        return;
      }
    }
    entries.set(paletteId, {
      firstSeenAt: existing?.firstSeenAt ?? Date.now(),
      name: existing?.name ?? details.name ?? null,
      shinySeenAt: existing?.shinySeenAt ?? (details.shiny === true ? Date.now() : null),
    });
    writeDex(entries);
  } catch {
    // best-effort — a full or blocked storage must not break visits
  }
}

type TrellisFamiliarityTier = "shy" | "regular" | "friend";

export type TrellisFamiliarity = {
  tier: TrellisFamiliarityTier;
  wary: boolean;
  visits: number;
  shoos: number;
};

// Behavior multipliers per tier; the pet reads these once per load. Shy pets
// keep visits short and arrive late; friends linger, return sooner, and
// greet. Wary pets (shooed too often) leave longer gaps between visits.
export const LOBSTER_FAMILIARITY_TUNING = {
  shy: { stayMul: 0.6, firstDelayMul: 1.3, gapMul: 1 },
  regular: { stayMul: 1, firstDelayMul: 1, gapMul: 1 },
  friend: { stayMul: 1.6, firstDelayMul: 0.7, gapMul: 0.8 },
  waryGapMul: 1.7,
} as const;

function readFamiliarityCounters(): { visits: number; shoos: number } {
  try {
    const raw = getSafeLocalStorage()?.getItem(FAMILIARITY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const visits = typeof record.visits === "number" && record.visits >= 0 ? record.visits : 0;
    const shoos = typeof record.shoos === "number" && record.shoos >= 0 ? record.shoos : 0;
    return { visits, shoos };
  } catch {
    return { visits: 0, shoos: 0 };
  }
}

function writeFamiliarityCounters(counters: { visits: number; shoos: number }): void {
  try {
    getSafeLocalStorage()?.setItem(FAMILIARITY_KEY, JSON.stringify(counters));
  } catch {
    // best-effort
  }
}

export function recordTrellisArrivalStats(): void {
  const counters = readFamiliarityCounters();
  writeFamiliarityCounters({ ...counters, visits: counters.visits + 1 });
}

export function recordTrellisShoo(): void {
  const counters = readFamiliarityCounters();
  writeFamiliarityCounters({ ...counters, shoos: counters.shoos + 1 });
}

export function getTrellisFamiliarity(): TrellisFamiliarity {
  const { visits, shoos } = readFamiliarityCounters();
  const tier: TrellisFamiliarityTier = visits < 3 ? "shy" : visits < 15 ? "regular" : "friend";
  const wary = shoos >= 3 && shoos > visits * 0.3;
  return { tier, wary, visits, shoos };
}

// Milestone honorifics for the hover title, earned by lifetime visits across
// all palettes. Highest earned title wins; below the first rung there is none.
const HONORIFICS: Array<[number, string]> = [
  [250, "Elder"],
  [100, "Captain"],
  [50, "Sir"],
];

export function trellisHonorific(visits: number): string | null {
  return HONORIFICS.find(([threshold]) => visits >= threshold)?.[1] ?? null;
}

// True when `now` is the month/day anniversary of a palette's first recorded
// visit. The elapsed guard keeps the first weeks from counting; Feb 29 firsts
// celebrate on leap years only - rarity is the point.
const ANNIVERSARY_MIN_ELAPSED_MS = 300 * 24 * 60 * 60 * 1000;

export function isTrellisFirstVisitAnniversary(firstSeenAt: number | null, now: Date): boolean {
  if (firstSeenAt === null || now.getTime() - firstSeenAt < ANNIVERSARY_MIN_ELAPSED_MS) {
    return false;
  }
  const first = new Date(firstSeenAt);
  return first.getMonth() === now.getMonth() && first.getDate() === now.getDate();
}
