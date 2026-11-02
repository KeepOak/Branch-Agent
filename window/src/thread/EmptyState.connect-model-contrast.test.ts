import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(`src/${file}`, "utf8");
const glass = read("glass/glass.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...glass.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

// Glass has ID-level specificity. Checking the primary button's own declarations alone
// misses the regression: these later control paints must exempt the solid action.
describe("Connect a model keeps its solid contrast pair", () => {
  for (const [name, selector, paint] of [
    ["canvas frost", ".g-clear :is(button, a[href], select", "background: var(--gp-fill)"],
    ["canvas hover lift", ".g-clear :is(button, a[href])):is(", "100vmax var(--gp-on)"],
    ["composer 7% fill", ".r1-content .r1c :is(button, summary):not(", "var(--ink) 7%"],
    ["composer 12% hover fill", ".r1-content .r1c :is(button, summary):hover", "var(--ink) 12%"],
  ]) {
    it(`exempts the primary action from ${name}`, () => {
      const rule = rules.find(([, selectors, declarations]) => selectors!.includes(selector!) && declarations!.includes(paint!));
      expect(rule, `missing ${name} rule`).toBeDefined();
      expect(rule![1]).toMatch(/:not\([^)]*\.connect-model-btn(?:,|\))/);
    });
  }

  it("uses --btn and --on-btn in empty chat and both composer styles", () => {
    for (const file of ["thread/empty.css", "composer/composer.css", "screens/composer/composer.css"]) {
      const declarations = /\.connect-model-btn\s*\{([^}]+)\}/.exec(read(file))![1]!;
      expect(declarations, file).toMatch(/background:\s*var\(--btn\)/);
      expect(declarations, file).toMatch(/color:\s*var\(--on-btn\)/);
    }
  });

  const tokens = read("theme/tokens.css");
  const themes = [
    ["light", tokens.slice(0, tokens.indexOf("/* §2.1 colour, Moonlight */"))],
    ["dark", /:root\[data-theme="dark"\]\s*\{([^}]+)\}/.exec(tokens)![1]!],
  ];
  for (const [theme, block] of themes) {
    it(`provides at least 4.5:1 ${theme} contrast from the theme tokens`, () => {
      const luminance = (token: string) => {
        const hex = new RegExp(`${token}:\\s*(#[0-9a-f]{6})`).exec(block!)![1]!;
        const rgb = [1, 3, 5].map((i) => {
          const c = parseInt(hex.slice(i, i + 2), 16) / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
      };
      const bg = luminance("--btn"), fg = luminance("--on-btn");
      expect((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
