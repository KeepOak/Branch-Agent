import { describe, expect, it } from "vitest";
import { boardIdFor, convState, dispatchLine, isToday } from "./cards-model";
import { computers } from "./data";

const now = new Date(2026, 9, 9, 15, 0, 0).getTime();
const at = (hour: number) => new Date(2026, 9, 9, hour, 0, 0).getTime();

describe("Canopy data", () => {
  it("lists this computer first, then a private computer that is off", () => {
    const list = computers({ nodes: [], computer: { configured: true, available: false }, sessions: [] });
    expect(list.map(c => [c.name, c.state])).toEqual([["This computer", "ok"], ["Private computer", "off"]]);
  });
  it("words results, board ids and conversation states from the engine's records", () => {
    expect(dispatchLine({ started: [{}], promoted: [], blocked: [{}], reclaimed: [], orchestrated: [], startFailures: [] })).toBe("Started 1. Made ready 0, blocked 1, released 0, organised 0. Couldn’t start 0.");
    expect(dispatchLine({})).toBe("No cards were started.");
    expect(boardIdFor("Website!", [{ id: "website" }])).toBe("website-2");
    expect(convState({ status: "todo" }, [], now)[0]).toBe("No conversation");
  });
});

describe("Today on the Board", () => {
  it("shows a card a Trunk is on now, whatever its last change", () => {
    for (const status of ["ready", "running", "review", "blocked"]) expect(isToday({ status, updatedAt: at(1) }, now)).toBe(true);
  });
  it("shows a finished or changed card only when it moved since midnight", () => {
    expect(isToday({ status: "done", completedAt: at(9) }, now)).toBe(true);
    expect(isToday({ status: "done", updatedAt: at(9) }, now)).toBe(true);
    expect(isToday({ status: "done", updatedAt: at(9) - 86_400_000 }, now)).toBe(false);
  });
  it("leaves out backlog and triage cards nothing touched today", () => {
    expect(isToday({ status: "backlog", updatedAt: at(1) - 86_400_000 }, now)).toBe(false);
    expect(isToday({ status: "triage", createdAt: at(1) - 86_400_000, updatedAt: at(1) - 86_400_000 }, now)).toBe(false);
  });
});
