import { describe, expect, it } from "vitest";
import { levelFor, pageAtLevel, pageLevel, pageName, searchSettings, settingsGroups } from "./settings-nav";

describe("settings nav", () => {
  it("has plain group names and omits achievements at every level", () => {
    const count = (l: "regular" | "advanced" | "technical") => settingsGroups(l).reduce((n, g) => n + g.pages.length, 0);
    expect([count("regular"), count("advanced"), count("technical")]).toEqual([22, 23, 24]);
    expect(settingsGroups("regular").map((g) => g.name)).toEqual(["General", "Trunks", "Safety", "Data", "About"]);
  });
  it("uses plain page names in navigation and search", () => {
    for (const [id, name] of [["agents", "Connected agents"], ["seasons", "Memory cleanup"], ["self", "Version & self-check"], ["secrets", "Saved passwords"]]) {
      expect(pageName(id)).toBe(name);
      expect(searchSettings(name, []).flatMap(g => g.hits.map(h => h.page.name))).toContain(name);
    }
    for (const level of ["regular", "advanced", "technical"] as const) {
      expect(settingsGroups(level).flatMap(g => g.pages).some(p => p.id === "achievements")).toBe(false);
    }
    expect(searchSettings("achievements", [])).toEqual([]);
  });
  it("hides Achievements until it counts real achievements", () => {
    const ids = (l: "regular" | "advanced" | "technical") => settingsGroups(l).flatMap((g) => g.pages.map((p) => p.id));
    expect(ids("technical")).not.toContain("achievements");
    expect(pageAtLevel("achievements", "technical")).toBe("general");
  });
  it("a level drop moves a hidden page to General", () => {
    expect(pageAtLevel("developer", "advanced")).toBe("general");
    expect(pageAtLevel("advanced", "regular")).toBe("general");
    expect(pageAtLevel("models", "regular")).toBe("models");
  });
  it("opening a page the level hides raises the level", () => {
    expect(levelFor("advanced", "regular")).toBe("advanced");
    expect(levelFor("developer", "regular")).toBe("technical");
    expect(levelFor("developer", "advanced")).toBe("technical");
    expect(levelFor("models", "technical")).toBe("technical");
    expect(levelFor("models", "regular")).toBe("regular");
    expect(levelFor("no-such-page", "advanced")).toBe("advanced");
  });
  it("search matches page names and keywords", () => {
    expect(searchSettings("telegram", []).flatMap((g) => g.hits.map((h) => h.page.id))).toEqual(["chatapps"]);
    expect(searchSettings("dark", []).flatMap((g) => g.hits.map((h) => h.page.id))).toEqual(["appearance"]);
    // DA-55: Customize's old Everywhere and Specialists tabs are Settings pages now, found by their old names too.
    expect(searchSettings("everywhere", []).flatMap((g) => g.hits.map((h) => h.page.id))).toEqual(["devices"]);
    expect(searchSettings("specialists", []).flatMap((g) => g.hits.map((h) => h.page.id))).toEqual(["helpers"]);
    expect([pageName("devices"), pageName("helpers")]).toEqual(["Devices & apps", "Helpers"]);
    expect(searchSettings("zzz", [])).toEqual([]);
    expect(pageName("local")).toBe("On this computer");
  });
  it("search lists matching rows under their page, with the level that shows them", () => {
    const rows = [{ page: "accounts", title: "Region", sec: "Accounts, technical", lv: 2 as const }, { page: "developer", title: "Region code", lv: 0 as const }];
    const hits = searchSettings("region", rows).flatMap((g) => g.hits);
    expect(hits.map((h) => [h.page.id, h.rows.map((r) => [r.title, r.lv])])).toEqual([["accounts", [["Region", 2]]], ["developer", [["Region code", 2]]]]);
    expect(pageLevel("advanced")).toBe("advanced");
  });
});
