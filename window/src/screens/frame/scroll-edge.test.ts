import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// One scroll edge under the floating header (audit F5): the conversation, places and Settings all scroll inside .r1-scroll, so one
// band keyed on that column's scrolled flag covers them all. These are contract checks on the shared rule, not pixel checks.
const read = (file: string) => readFileSync(resolve(__dirname, file), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const frame = strip(read("frame.css"));
const glass = strip(read("../../glass/glass.css"));
const edgeFade = read("../../glass/useEdgeFade.ts");
const frameTsx = read("Frame.tsx");

/** The body of the first rule whose selector starts with `selector`. */
function bodyOf(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  return css.slice(start + selector.length + 2, css.indexOf("}", start));
}

describe("scroll edge under the header (shared frame rule)", () => {
  it("hides the band at rest and fades it in once the conversation column has scrolled", () => {
    const rest = bodyOf(frame, ".r1-header::before");
    expect(rest).toMatch(/opacity: 0/);
    expect(rest).toMatch(/height: calc\(var\(--hdr\) \+ 28px\)/);
    expect(bodyOf(frame, ".r1-conversation:has(> .r1-scroll[data-top]) > .r1-header::before")).toMatch(/opacity: 1/);
  });

  it("paints solid --bg through the header and fades it out below, with tokens only", () => {
    const rest = bodyOf(frame, ".r1-header::before");
    expect(rest).toMatch(/linear-gradient\(to bottom, var\(--bg\) var\(--hdr\), transparent\)/);
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    expect(rest).toMatch(/pointer-events: none/);
    expect(rest).toMatch(/z-index: -1/);
  });

  it("is solid --bg when transparency is reduced, in both the attribute and the media forms", () => {
    expect(frame).toMatch(/:root\[data-transparency="reduce"\] \.r1-header::before \{ background: var\(--bg\); \}/);
    expect(frame).toMatch(/@media \(prefers-reduced-transparency: reduce\) \{ :root:not\(\[data-transparency\]\) \.r1-header::before \{ background: var\(--bg\); \} \}/);
  });

  it("stops at the edge of a right-docked pane instead of fading over it", () => {
    expect(frame).toMatch(/\.r1-conversation\[data-beside="right"\] > \.r1-header::before \{ right: var\(--r1-beside\); \}/);
  });

  it("stops the stuck thread bar below the fade, not on the header row", () => {
    expect(frame).toMatch(/:root:not\(#sg#sg#sg#sg\) \.r1-content > \.r1-topic-host \{ top: calc\(var\(--hdr\) \+ 36px\); \}/);
  });

  it("keys on the scrolled flag the Frame already maintains for the scroll column", () => {
    expect(frameTsx).toMatch(/<div className="r1-scroll edge-fade" ref=\{scroll\}>/);
    expect(edgeFade).toMatch(/node\.toggleAttribute\("data-top", node\.scrollTop > 0\)/);
  });

  it("retires the one-off conversation scrim from glass.css", () => {
    expect(glass).not.toMatch(/r1-conversation > \.r1-header::before/);
    expect(glass).not.toMatch(/\.r1-header::before/);
  });
});
