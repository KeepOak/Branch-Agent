import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Seedbank's root is .sb (screens/seedbank/seedbank.css). The status bar's button rules must stay inside .statusbar, or
// they turn Seedbank's grid into a 16px inline-flex row and the page shows nothing (owner, 2026-10-15).
it("keeps the status bar's .sb button rules scoped to the status bar", () => {
  const code = readFileSync(resolve(__dirname, "frame.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const unscoped = code.split("\n").filter((line) => /^\s*(button)?\.sb(\s|,|\{|\[|:|\.)/.test(line));
  expect(unscoped).toEqual([]);
  expect(code).toMatch(/\.statusbar \.sb \{\s*display: inline-flex;/);
});
