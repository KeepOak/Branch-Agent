import { expect, it } from "vitest";
import { collapseGrafted, GRAFTED_OFFLINE_HIDE_MS, normalizeAgentName } from "./contacts-model";

const NOW = Date.UTC(2026, 9, 9);
type Row = { id: string; kind: string; name: string; where?: string; lastActivityAt: number; offline?: boolean };
const graft = (id: string, name: string, where: string, lastActivityAt: number, offline = false): Row => ({ id, kind: "outside", name, where, lastActivityAt, offline });

it("shows one grafted coordinator per name and computer, the newest one", () => {
  const rows: Row[] = [
    graft("branch-coordinator-a1b2c3", "branch-coordinator", "mac-a", NOW - 5_000),
    graft("branch-coordinator-d4e5f6", "branch-coordinator", "mac-a", NOW - 1_000),
    graft("Branch Coordinator-0a0a0a", "Branch Coordinator", "mac-a", NOW - 3_000),
  ];
  const out = collapseGrafted(rows, NOW);
  expect(out.map((r) => r.id)).toEqual(["branch-coordinator-d4e5f6"]);
});

it("keeps the same agent on a different computer as its own row", () => {
  const rows: Row[] = [graft("coord-1", "Branch Coordinator", "mac-a", NOW), graft("coord-2", "Branch Coordinator", "mac-b", NOW - 1)];
  expect(collapseGrafted(rows, NOW).map((r) => r.id)).toEqual(["coord-1", "coord-2"]);
});

it("hides a grafted agent that has been offline for over seven days, and passes other rows through", () => {
  const trunk: Row = { id: "trunk:builder", kind: "trunk", name: "Builder", lastActivityAt: 0 };
  const old = graft("old-1", "Scout", "mac-a", NOW - GRAFTED_OFFLINE_HIDE_MS - 1, true);
  const recent = graft("recent-1", "Scout", "mac-a", NOW - 60_000, true);
  expect(collapseGrafted([trunk, old, recent], NOW).map((r) => r.id)).toEqual(["trunk:builder", "recent-1"]);
});

it("normalises names so case, hyphens and spaces don't split a row", () => {
  expect(normalizeAgentName("Branch-Coordinator")).toBe(normalizeAgentName("branch coordinator"));
});
