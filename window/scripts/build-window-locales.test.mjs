// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUT, buildCatalogSource } from "./build-window-locales.mjs";

describe("the window's Settings translations (catalog.ts)", () => {
  it("is exactly what build-window-locales.mjs writes from the translation memory, so a rerun drops nothing", () => {
    expect(readFileSync(OUT, "utf8")).toBe(buildCatalogSource().source);
  });

  it("has Accounts & usage in every language from the translation memory, not only in catalog.ts", () => {
    const { source } = buildCatalogSource();
    const catalog = JSON.parse(source.slice(source.indexOf("= {") + 2, source.lastIndexOf(";")));
    expect(Object.keys(catalog).length).toBe(20);
    for (const words of Object.values(catalog)) expect(words["Accounts & usage"]).toMatch(/\S/);
    expect(catalog.de["Accounts & usage"]).toBe("Konten & Nutzung");
  });
});
