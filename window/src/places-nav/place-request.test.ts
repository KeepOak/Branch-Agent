import { describe, expect, it } from "vitest";
import type { PlaceId } from "./routes";
import { placeRequest } from "./place-request";

const PLACES: PlaceId[] = ["customize", "library", "automations"];

describe("placeRequest", () => {
  it("keeps the tab a place was asked to open on", () => {
    expect(placeRequest({ place: "customize", tab: "Plugins" }, PLACES)).toEqual({ place: "customize", tab: "Plugins" });
  });

  it("opens a place on its default tab when no tab is named", () => {
    expect(placeRequest({ place: "library" }, PLACES)).toEqual({ place: "library" });
    expect(placeRequest({ place: "library", tab: "" }, PLACES)).toEqual({ place: "library" });
  });

  it("ignores a request that names no place of ours", () => {
    expect(placeRequest({ place: "settings", tab: "Plugins" }, PLACES)).toBeNull();
    expect(placeRequest({}, PLACES)).toBeNull();
    expect(placeRequest(null, PLACES)).toBeNull();
  });
});
