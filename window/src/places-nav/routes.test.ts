import { describe, expect, it } from "vitest";
import { PLACES, parseRoute, windowTitle } from "./routes";

describe("routes", () => {
  it("parses saved routes and refuses damaged ones", () => {
    expect(parseRoute('{"kind":"chat","key":"agent:dev:main"}')).toEqual({ kind: "chat", key: "agent:dev:main" });
    expect(parseRoute('{"kind":"place","place":"inbox"}')).toEqual({ kind: "place", place: "inbox" });
    expect(parseRoute('{"kind":"place","place":"nowhere"}')).toBeNull();
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
});
