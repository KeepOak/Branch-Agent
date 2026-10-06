import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES } from "./theme.ts";
import { BUILTIN_THEME_IDS, isBuiltinThemeId } from "./theme-ids.ts";
import { LEGACY_THEME_CATALOG } from "./legacy-theme-catalog.ts";

describe("restored theme catalogue", () => {
  it("keeps the 44 old looks plus Paper and Branch Slate as distinct built-ins", () => {
    const classic = ["grove", "paper", ...LEGACY_THEME_CATALOG.map((theme) => theme.id)];
    expect(LEGACY_THEME_CATALOG).toHaveLength(44);
    expect(classic).toHaveLength(46);
    expect(new Set(classic).size).toBe(46);
    expect(classic.every((id) => isBuiltinThemeId(id) && BUILTIN_THEMES.some((theme) => theme.id === id))).toBe(true);
    expect(BUILTIN_THEMES.find((theme) => theme.id === "dracula")).toMatchObject({ name: "Dracula", modes: ["light", "dark"] });
    expect(BUILTIN_THEME_IDS.length).toBe(BUILTIN_THEMES.length);
  });

  it("ships both Control UI palettes for every restored look", () => {
    for (const theme of LEGACY_THEME_CATALOG) {
      const css = readFileSync(new URL(`../../../ui/public/themes/${theme.id}.css`, import.meta.url), "utf8");
      expect(css).toContain(`data-theme="${theme.id}"`);
      expect(css).toContain(`data-theme="${theme.id}-light"`);
    }
  });
});
