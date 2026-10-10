import { expect, it } from "vitest";
import { collapseGrafted, normalizeAgentName } from "./contacts-model";

type Row = { id: string; kind: string; name: string; where?: string; lastActivityAt: number };
const graft = (id: string, name: string, where: string, lastActivityAt: number): Row => ({ id, kind: "outside", name, where, lastActivityAt });

it("shows one grafted coordinator per name and computer, the newest one", () => {
  const rows: Row[] = [
    graft("branch-coordinator-a1b2c3", "branch-coordinator", "mac-a", 5_000),
    graft("branch-coordinator-d4e5f6", "branch-coordinator", "mac-a", 1_000),
    graft("Branch Coordinator-0a0a0a", "Branch Coordinator", "mac-a", 3_000),
  ];
  expect(collapseGrafted(rows).map((r) => r.id)).toEqual(["branch-coordinator-a1b2c3"]);
});

it("keeps the same agent on a different computer as its own row", () => {
  const rows: Row[] = [graft("coord-1", "Branch Coordinator", "mac-a", 1), graft("coord-2", "Branch Coordinator", "mac-b", 2)];
  expect(collapseGrafted(rows).map((r) => r.id)).toEqual(["coord-1", "coord-2"]);
});

it("passes other rows through unchanged and keeps the row order", () => {
  const trunk: Row = { id: "trunk:builder", kind: "trunk", name: "Builder", lastActivityAt: 0 };
  const rows: Row[] = [trunk, graft("scout-1", "Scout", "mac-a", 9), graft("scout-2", "Scout", "mac-a", 4)];
  expect(collapseGrafted(rows).map((r) => r.id)).toEqual(["trunk:builder", "scout-1"]);
});

it("normalises names so case, hyphens and spaces don't split a row", () => {
  expect(normalizeAgentName("Branch-Coordinator")).toBe(normalizeAgentName("branch coordinator"));
});
