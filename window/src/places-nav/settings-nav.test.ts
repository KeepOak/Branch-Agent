import { describe, expect, it } from "vitest";
import { levelFor, pageAtLevel, pageLevel, pageName, searchSettings, settingsGroups } from "./settings-nav";

describe("settings nav", () => {
  it("has 21, 22 and 23 pages by level (Grafts is in Safety, Backups in Care)", () => {
    const count = (l: "regular" | "advanced" | "technical") => settingsGroups(l).reduce((n, g) => n + g.pages.length, 0);
    expect([count("regular"), count("advanced"), count("technical")]).toEqual([21, 22, 23]);
    expect(settingsGroups("regular").map((g) => g.name)).toEqual(["General", "Your assistant", "Safety", "Care"]);
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
