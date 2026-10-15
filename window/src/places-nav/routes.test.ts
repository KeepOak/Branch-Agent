import { describe, expect, it } from "vitest";
import { PLACE_NAMES, PLACES, loadRoute, parseRoute, placeTitle, saveRoute, windowTitle, type PlaceId } from "./routes";

describe("routes", () => {
  it("parses saved routes and refuses damaged ones", () => {
    expect(parseRoute('{"kind":"chat","key":"agent:dev:main"}')).toEqual({ kind: "chat", key: "agent:dev:main" });
    expect(parseRoute('{"kind":"place","place":"inbox"}')).toEqual({ kind: "place", place: "inbox" });
    expect(parseRoute('{"kind":"place","place":"nowhere"}')).toBeNull();
    expect(parseRoute('{"kind":"place","place":"seedbank"}')).toEqual({ kind: "place", place: "seedbank" });
    expect(parseRoute('{"kind":"settings","page":"models"}')).toEqual({ kind: "settings", page: "models" });
    expect(parseRoute("{not json")).toBeNull();
    expect(parseRoute(null)).toBeNull();
  });
  it("lists the seven places in the sidebar's order", () => {
    expect(PLACES.map((p) => p.name)).toEqual(["Overview", "Canopy", "Inbox", "Automations", "Library", "People", "Customize"]);
  });
  it("window title", () => {
    expect(windowTitle("Sapling", 0, false)).toBe("Sapling — Branch");
    expect(windowTitle("Sapling", 2, false)).toBe("(2) Sapling — Branch");
    expect(windowTitle("Sapling", 2, true)).toBe("(Offline) Sapling — Branch");
  });
  it("keeps a dedicated conversation window's route separate from the main window", () => {
    const original = location.href;
    const main = localStorage.getItem("branch.route");
    try {
      history.replaceState({}, "", "/?conversation=agent%3Aoak%3Amain");
      sessionStorage.removeItem("branch.route");
      expect(loadRoute()).toEqual({ kind: "chat", key: "agent:oak:main" });
      saveRoute({ kind: "chat", key: "agent:oak:topic" });
      expect(loadRoute()).toEqual({ kind: "chat", key: "agent:oak:topic" });
      expect(localStorage.getItem("branch.route")).toBe(main);
    } finally {
      history.replaceState({}, "", original);
      sessionStorage.removeItem("branch.route");
    }
  });
});

describe("place titles", () => {
  const every: PlaceId[] = ["overview", "canopy", "inbox", "automations", "library", "people", "customize", "office", "seedbank"];
  it("gives every place a human title, never its raw id", () => {
    for (const id of every) {
      const title = placeTitle(id);
      expect(title).toBe(PLACE_NAMES[id]);
      expect(title).not.toBe(id);
      expect(title).toMatch(/^[A-Z][a-z]+$/);
    }
  });
  it("names the places in the sidebar the same way the registry does", () => {
    for (const place of PLACES) expect(placeTitle(place.id)).toBe(place.name);
  });
  it("names Grove and Seedbank, which have no sidebar row", () => {
    expect(placeTitle("office")).toBe("Grove");
    expect(placeTitle("seedbank")).toBe("Seedbank");
  });
});
