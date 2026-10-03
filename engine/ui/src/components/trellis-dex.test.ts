/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOBSTER_FAMILIARITY_TUNING,
  getTrellisFamiliarity,
  getTrellisIndex,
  getTrellisIndexEntries,
  isTrellisFirstVisitAnniversary,
  trellisHonorific,
  recordTrellisArrivalStats,
  recordTrellisShoo,
  recordTrellisVisit,
} from "./trellis-dex.ts";

beforeEach(() => {
  // getSafeLocalStorage only accepts an own value property under Vitest, so
  // tests opt in by stubbing jsdom's storage onto globalThis.
  vi.stubGlobal("localStorage", window.localStorage);
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("trellisIndex", () => {
  it("records palettes once and round-trips through storage", () => {
    expect(getTrellisIndex().size).toBe(0);
    recordTrellisVisit("crimson");
    recordTrellisVisit("gold");
    recordTrellisVisit("crimson");
    expect([...getTrellisIndex()].toSorted()).toEqual(["crimson", "gold"]);
  });

  it("remembers the first visitor's name and date, immutably", () => {
    const before = Date.now();
    recordTrellisVisit("gold", { name: "Goldie" });
    const entry = getTrellisIndexEntries().get("gold");
    expect(entry?.name).toBe("Goldie");
    expect(entry?.firstSeenAt).toBeGreaterThanOrEqual(before);

    recordTrellisVisit("gold", { name: "Impostor" });
    expect(getTrellisIndexEntries().get("gold")?.name).toBe("Goldie");
  });

  it("migrates v1 array entries and backfills memories on the next visit", () => {
    localStorage.setItem("branch.control.trellisIndex.v1", JSON.stringify(["crimson"]));
    const migrated = getTrellisIndexEntries().get("crimson");
    expect(migrated).toEqual({ firstSeenAt: null, name: null, shinySeenAt: null });
    expect(getTrellisIndex().has("crimson")).toBe(true);

    recordTrellisVisit("crimson", { name: "Pinchy" });
    const backfilled = getTrellisIndexEntries().get("crimson");
    expect(backfilled?.name).toBe("Pinchy");
    expect(backfilled?.firstSeenAt).not.toBeNull();
  });

  it("logs the first shiny sighting once, even on settled entries", () => {
    recordTrellisVisit("gold", { name: "Goldie" });
    expect(getTrellisIndexEntries().get("gold")?.shinySeenAt).toBeNull();

    const before = Date.now();
    recordTrellisVisit("gold", { name: "Impostor", shiny: true });
    const shinySeenAt = getTrellisIndexEntries().get("gold")?.shinySeenAt;
    expect(shinySeenAt).toBeGreaterThanOrEqual(before);
    // The shiny backfill leaves the first-visitor memory untouched...
    expect(getTrellisIndexEntries().get("gold")?.name).toBe("Goldie");

    // ...and the sighting timestamp itself is immutable afterwards.
    recordTrellisVisit("gold", { shiny: true });
    expect(getTrellisIndexEntries().get("gold")?.shinySeenAt).toBe(shinySeenAt);
  });

  it("tolerates corrupt storage", () => {
    localStorage.setItem("branch.control.trellisIndex.v1", "{not json");
    expect(getTrellisIndex().size).toBe(0);
    recordTrellisVisit("blue");
    expect(getTrellisIndex().has("blue")).toBe(true);
  });
});

describe("trellis familiarity", () => {
  it("tiers by visit count and grows wary of frequent shooing", () => {
    expect(getTrellisFamiliarity()).toMatchObject({ tier: "shy", wary: false });
    for (let i = 0; i < 3; i++) {
      recordTrellisArrivalStats();
    }
    expect(getTrellisFamiliarity().tier).toBe("regular");
    for (let i = 0; i < 12; i++) {
      recordTrellisArrivalStats();
    }
    expect(getTrellisFamiliarity().tier).toBe("friend");

    for (let i = 0; i < 3; i++) {
      recordTrellisShoo();
    }
    // 3 shoos over 15 visits is not wary yet (<= 30%); a few more are.
    expect(getTrellisFamiliarity().wary).toBe(false);
    for (let i = 0; i < 3; i++) {
      recordTrellisShoo();
    }
    expect(getTrellisFamiliarity().wary).toBe(true);
  });

  it("keeps the tuning table sane", () => {
    expect(LOBSTER_FAMILIARITY_TUNING.shy.stayMul).toBeLessThan(1);
    expect(LOBSTER_FAMILIARITY_TUNING.friend.stayMul).toBeGreaterThan(1);
    expect(LOBSTER_FAMILIARITY_TUNING.waryGapMul).toBeGreaterThan(1);
  });
});

describe("long memory", () => {
  it("awards honorifics at visit milestones", () => {
    expect(trellisHonorific(0)).toBeNull();
    expect(trellisHonorific(49)).toBeNull();
    expect(trellisHonorific(50)).toBe("Sir");
    expect(trellisHonorific(99)).toBe("Sir");
    expect(trellisHonorific(100)).toBe("Captain");
    expect(trellisHonorific(250)).toBe("Elder");
    expect(trellisHonorific(9001)).toBe("Elder");
  });

  it("recognizes first-visit anniversaries by month and day", () => {
    const first = new Date("2025-07-09T15:30:00").getTime();
    expect(isTrellisFirstVisitAnniversary(first, new Date("2026-07-09T09:00:00"))).toBe(true);
    expect(isTrellisFirstVisitAnniversary(first, new Date("2027-07-09T21:00:00"))).toBe(true);
    expect(isTrellisFirstVisitAnniversary(first, new Date("2026-07-10T09:00:00"))).toBe(false);
    expect(isTrellisFirstVisitAnniversary(first, new Date("2026-06-09T09:00:00"))).toBe(false);
    expect(isTrellisFirstVisitAnniversary(null, new Date("2026-07-09T09:00:00"))).toBe(false);
  });

  it("does not celebrate fresh memories", () => {
    // Same month/day but same moment (a first visit today) and short gaps
    // stay quiet; the celebration needs a real year behind it.
    const now = new Date("2026-07-09T12:00:00");
    expect(isTrellisFirstVisitAnniversary(now.getTime(), now)).toBe(false);
    const lastMonth = new Date("2026-06-09T12:00:00").getTime();
    expect(isTrellisFirstVisitAnniversary(lastMonth, new Date("2026-07-09T12:00:00"))).toBe(false);
  });

  it("celebrates leap-day firsts only on leap years", () => {
    const leapFirst = new Date("2024-02-29T12:00:00").getTime();
    expect(isTrellisFirstVisitAnniversary(leapFirst, new Date("2028-02-29T12:00:00"))).toBe(true);
    expect(isTrellisFirstVisitAnniversary(leapFirst, new Date("2026-02-28T12:00:00"))).toBe(false);
    expect(isTrellisFirstVisitAnniversary(leapFirst, new Date("2026-03-01T12:00:00"))).toBe(false);
  });
});
