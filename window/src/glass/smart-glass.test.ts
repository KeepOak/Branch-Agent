import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Smart glass (owner, 2026-10-15): words never sit on pills, floating layers are one tinted glass sheet, no scrollbars.
const css = readFileSync(resolve(__dirname, "glass.css"), "utf8");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("smart glass", () => {
  it("gives .g-label no pill shape of its own and flattens it in the layer", () => {
    expect(code).not.toMatch(/\.g-label:not\(#g48\) \{[^}]*border-radius: var\(--r-pill\)/);
    expect(code).toMatch(/:root:not\(#sg#sg#sg#sg\) \.g-label:not\(#g48#g48#g48\) \{[^}]*background: none[^}]*padding: 0|padding: 0[^}]*background: none/);
  });
  it("hides every scrollbar", () => {
    expect(code).toMatch(/:root:not\(#sg#sg#sg#sg\) \* \{ scrollbar-width: none; \}/);
    expect(code).toMatch(/::-webkit-scrollbar \{ display: none;/);
  });
  it("paints popovers and floating layers as one tinted, blurred sheet with plain rows", () => {
    expect(code).toMatch(/:is\(\.g-popover, \.g-float\):not\(#g48#g48#g48\) \{ background: var\(--sg-glass\); backdrop-filter: var\(--sg-blur\)/);
    expect(code).toMatch(/:is\(\.g-popover, \.g-float, \[role=menu\]\) :is\(button, a\[href\], \[role=menuitem\]\)[^{]*\{ background: transparent; box-shadow: none;/);
  });
  it("needs no !important and turns solid when transparency is reduced", () => {
    expect(code).not.toMatch(/!important/);
    expect(code).toMatch(/:root\[data-transparency="reduce"\]:not\(#sg#sg#sg#sg\) :is\(\.g-popover, \.g-float, \.r1-topic-host > \.topicsT5\) \{ background: var\(--bg\)/);
  });
});

describe("smart glass, batch 3", () => {
  it("makes the re-hosted Classic popovers one glass sheet with plain rows, solid when transparency is reduced", () => {
    expect(code).toMatch(/:root:not\(#sg#sg#sg#sg\) \.pop:is\(\.menu, \.panel\) \{ background: color-mix\(in srgb, var\(--bg\) 94%/);
    expect(code).toMatch(/:root\[data-transparency="reduce"\]:not\(#sg#sg#sg#sg\) \.pop:is\(\.menu, \.panel\) \{ background: var\(--bg\)/);
  });
  it("fades the transcript out under the window header", () => {
    expect(code).toMatch(/\.r1-conversation > \.r1-header::before \{ content: ""; position: absolute;/);
  });
});
