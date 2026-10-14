import { expect, it } from "vitest";
import { DEFAULT_TRUNK_NAME, displayTrunkTitle, trunkDisplayName } from "./trunk-name";

it("shows the identity name, then the name, for a Trunk that has one", () => {
  expect(trunkDisplayName({ id: "scout", identity: { name: "Scout" } })).toBe("Scout");
  expect(trunkDisplayName({ id: "scout", name: "Scout" })).toBe("Scout");
});

it("never shows the default Trunk's id: a nameless main Trunk reads as Sapling", () => {
  expect(trunkDisplayName({ id: "main" })).toBe(DEFAULT_TRUNK_NAME);
  expect(trunkDisplayName({ id: "main", identity: {} })).toBe("Sapling");
});

it("never shows another Trunk's id either", () => {
  expect(trunkDisplayName({ id: "office-3" })).toBe("Trunk");
  expect(trunkDisplayName(null)).toBe("Trunk");
});

it("reads a Trunk's main title as its name, so the default Trunk shows Sapling and never main", () => {
  expect(displayTrunkTitle("main", "main")).toBe(DEFAULT_TRUNK_NAME);
  expect(displayTrunkTitle("", "main")).toBe(DEFAULT_TRUNK_NAME);
  expect(displayTrunkTitle("Scout", "scout")).toBe("Scout");
  expect(displayTrunkTitle("scout", "scout")).toBe("Trunk");
});
