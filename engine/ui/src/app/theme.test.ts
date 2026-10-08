// From openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:ui/src/app/theme.test.ts (atlas UI-MOBILE-WEB-0071). Changed for Branch: retained existing rebranding and assertions; registered for Harvest CI.
// @vitest-environment node
// Control UI tests cover theme behavior.
import { describe, expect, it, vi } from "vitest";
import { parseThemeSelection, resolveTheme, type ThemeName } from "./theme.ts";

describe("resolveTheme", () => {
  it.each([
    ["grove", "dark", "light"],
    ["knot", "openknot", "openknot-light"],
    ["dash", "dash", "dash-light"],
  ] satisfies [ThemeName, string, string][])(
    "resolves %s in both explicit modes",
    (theme, dark, light) => {
      expect(resolveTheme(theme, "dark")).toBe(dark);
      expect(resolveTheme(theme, "light")).toBe(light);
    },
  );

  it("uses system preference when mode is system", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(resolveTheme("knot", "system")).toBe("openknot-light");
    vi.unstubAllGlobals();
  });
});

describe("parseThemeSelection", () => {
  it("falls back to defaults for unknown stored values", () => {
    expect(parseThemeSelection("fieldmanual", "invalid-mode")).toEqual({
      theme: "grove",
      mode: "system",
    });
    expect(parseThemeSelection("dash", "light")).toEqual({
      theme: "dash",
      mode: "light",
    });
  });
});
