import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sidebar = readFileSync(resolve(__dirname, "sidebar.css"), "utf8").replace(/\s+/g, " ");
const glass = readFileSync(resolve(__dirname, "../../glass/glass.css"), "utf8").replace(/\s+/g, " ");
const frame = readFileSync(resolve(__dirname, "../../shell/frame.css"), "utf8").replace(/\s+/g, " ");

describe("Trunk ••• menu surface (spec-v23 .pop, #1874)", () => {
  it("paints the R1 popover as a solid --raise sheet with --pop edge and shadow, never transparent", () => {
    expect(sidebar).toMatch(
      /:root:not\(#sg#sg#sg#sg\) \.g-popover:has\(> \.r1sb-pop\):not\(#g48#g48#g48\) \{ background: var\(--raise\); backdrop-filter: none; -webkit-backdrop-filter: none; border: 0; border-radius: var\(--r-menu\); box-shadow: var\(--pop\); padding: 6px; \}/,
    );
    expect(sidebar).not.toMatch(/\.g-popover:has\(> \.r1sb-pop\) \{ background: transparent;/);
  });

  it("paints classic .pop.menu and .pop.panel the same way, including the frame sheet", () => {
    expect(glass).toMatch(
      /:root:not\(#sg#sg#sg#sg\) \.pop:is\(\.menu, \.panel\) \{ background: var\(--raise\); backdrop-filter: none; -webkit-backdrop-filter: none; border: 0; border-radius: var\(--r-menu\); box-shadow: var\(--pop\); \}/,
    );
    expect(frame).toMatch(/\.pop \{[^}]*background: var\(--raise\);[^}]*box-shadow: var\(--pop\);/);
    expect(frame).not.toMatch(/\.pop \{[^}]*background: var\(--glass17\)/);
  });
});
