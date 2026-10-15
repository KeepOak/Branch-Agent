import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Owner, 2026-10-15: side panel tabs were cut to "Tim…" and Grove's map sat in a 360px strip.
const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
it("gives the side panel's tabs their own row and its tools no box", () => {
  const css = read("../pane/r1-side-pane.css");
  expect(css).toMatch(/\.r1-pane \.pane-head \{ flex-wrap: wrap;/);
  expect(css).toMatch(/\.r1-pane \.pane-head > \.pane-tabs \{ order: 9; flex: 1 0 100%;/);
  expect(css).toMatch(/\.r1-pane \.pane-head > :is\(button, a\[href\]\):not\(#g48#g48#g48#g48\) \{ background: transparent; box-shadow: none;/);
});
it("lets a place fill the column under the header", () => {
  const css = read("frame.css");
  expect(css).toMatch(/\.r1-content:has\(> \.enter11\) \{ display: flex; flex-direction: column; \}/);
  expect(css).toMatch(/\.pixel-office-view > \.pixel-office-stage \{ min-height: 0; height: auto; \}/);
});
