import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ROSTER_COLOURS, TrunkPebbleLooks, rosterPebbleLooks } from "./appearance";
import { Face } from "./Face";

// DA-04: Builder, Planner and Researcher all showed the same pebble in the sidebar.
const face = (l: { colour?: string; shape?: string; eyes?: string }) => `${l.colour}|${l.shape}|${l.eyes}`;

describe("a Trunk roster gets a distinct face per Trunk (DA-04)", () => {
  it("gives Trunks with no look of their own different colours, shapes and eyes", () => {
    const looks = rosterPebbleLooks([{ name: "Builder" }, { name: "Planner" }, { name: "Researcher" }]);
    const all = ["Builder", "Planner", "Researcher"].map((n) => looks[n]);
    expect(new Set(all.map((l) => l.colour)).size).toBe(3);
    expect(new Set(all.map((l) => l.shape)).size).toBe(3);
    expect(new Set(all.map((l) => l.eyes)).size).toBe(3);
    for (const l of all) expect(ROSTER_COLOURS).toContain(l.colour);
  });

  it("keeps a Trunk's own look and steers the others away from its colour", () => {
    const looks = rosterPebbleLooks([{ name: "Oak", colour: "#2f8c86", shape: "Leaf", eyes: "Wide" }, ...ROSTER_COLOURS.slice(1).map((_, i) => ({ name: `T${i}` }))]);
    expect(looks.Oak).toEqual({ colour: "#2f8c86", shape: "Leaf", eyes: "Wide" });
    const others = Object.entries(looks).filter(([n]) => n !== "Oak").map(([, l]) => l.colour);
    expect(others).not.toContain("#2F8C86");
    expect(new Set(others).size).toBe(others.length);
  });

  it("never repeats a whole face, even past the palette", () => {
    const looks = rosterPebbleLooks(Array.from({ length: 20 }, (_, i) => ({ name: `Trunk ${i}` })));
    expect(new Set(Object.values(looks).map(face)).size).toBe(20);
  });

  it("draws the same faces whatever order the roster arrives in", () => {
    const names = ["Builder", "Planner", "Researcher", "Juniper"].map((name) => ({ name }));
    expect(rosterPebbleLooks(names)).toEqual(rosterPebbleLooks(names.toReversed()));
  });

  it("paints each sidebar face in its own roster colour", () => {
    const looks = rosterPebbleLooks([{ name: "Builder" }, { name: "Planner" }, { name: "Researcher" }]);
    const markup = renderToStaticMarkup(
      <TrunkPebbleLooks.Provider value={looks}>
        <Face size={20} label="Builder" />
        <Face size={20} label="Planner" />
        <Face size={20} label="Researcher" />
      </TrunkPebbleLooks.Provider>,
    );
    const backgrounds = [...markup.matchAll(/background:(#[0-9A-F]{6})/gi)].map((m) => m[1]);
    expect(backgrounds).toEqual(["Builder", "Planner", "Researcher"].map((n) => looks[n].colour));
    expect(new Set(backgrounds).size).toBe(3);
  });

  it("fills a Trunk screen's partial look from the roster, so it matches the sidebar", () => {
    const looks = rosterPebbleLooks([{ name: "Builder" }, { name: "Planner" }]);
    const markup = renderToStaticMarkup(
      <TrunkPebbleLooks.Provider value={looks}>
        <Face size={20} label="Builder" pebbleLook={{ colour: undefined, shape: undefined, eyes: undefined }} />
      </TrunkPebbleLooks.Provider>,
    );
    expect(markup).toContain(`background:${looks.Builder.colour}`);
  });
});
