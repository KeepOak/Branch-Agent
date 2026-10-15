import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// One scroll edge for the header chrome (audit F5). The chrome is the pill row, plus the conversation's thread row when it shows.
// --r1-chrome-h drives the scroll edge, the thread row's sticky offset and the column's top spacer. These are contract checks on
// the shared rules, not pixel checks; the shots in the PR body cover the rendering.
const read = (file: string) => readFileSync(resolve(__dirname, file), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const frame = strip(read("frame.css"));
const glass = strip(read("../../glass/glass.css"));
const tokens = strip(read("../../theme/tokens.css"));
const edgeFade = read("../../glass/useEdgeFade.ts");
const frameTsx = read("Frame.tsx");

/** The body of the first rule whose selector is exactly `selector`. */
function bodyOf(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  return css.slice(start + selector.length + 2, css.indexOf("}", start));
}

describe("header chrome height (one variable drives the scroll edge, the thread row and the column's top)", () => {
  it("is the pill row by default and adds the thread row when the conversation shows one", () => {
    expect(bodyOf(frame, ".r1-conversation")).toMatch(/--r1-chrome-h: var\(--hdr\)/);
    expect(frame).toMatch(
      /\.r1-conversation:has\(> \.r1-scroll > \.r1-content > \.r1-topic-host\) \{ --r1-chrome-h: calc\(var\(--hdr\) \+ var\(--r1-topic-row\)\); \}/,
    );
    expect(tokens).toMatch(/--r1-topic-row: 42px;/);
  });

  it("puts the column's top offset in a spacer, not in the scroller's padding", () => {
    expect(bodyOf(frame, ".r1-scroll")).not.toMatch(/(?<![-\w])padding-top/);
    expect(bodyOf(frame, ".r1-top-space")).toMatch(/height: calc\(var\(--r1-chrome-h\) \+ 8px\)/);
    expect(frameTsx).toMatch(/<div ref=\{content\} className="r1-content"><div className="r1-top-space" aria-hidden="true" \/>/);
  });
});

describe("scroll edge (a sticky band inside the scroll column, under the pills and under the thread row)", () => {
  it("is the first child of the scroll column, hidden at rest and shown once the column has scrolled", () => {
    expect(frameTsx).toMatch(/<div className="r1-scroll edge-fade" ref=\{scroll\}><div className="r1-scroll-edge" aria-hidden="true" \/>/);
    const anchor = bodyOf(frame, ".r1-scroll-edge");
    expect(anchor).toMatch(/position: sticky; top: 0;/);
    expect(anchor).toMatch(/z-index: 35/);
    expect(anchor).toMatch(/height: 0/);
    expect(anchor).toMatch(/opacity: 0/);
    expect(anchor).toMatch(/pointer-events: none/);
    expect(bodyOf(frame, ".r1-conversation:has(> .r1-scroll[data-top]) .r1-scroll-edge")).toMatch(/opacity: 1/);
  });

  it("paints solid --bg through the chrome and fades out over 28px below it, with tokens only", () => {
    const band = bodyOf(frame, ".r1-scroll-edge::before");
    expect(band).toMatch(/height: calc\(var\(--r1-chrome-h\) \+ 28px\)/);
    expect(band).toMatch(/linear-gradient\(to bottom, var\(--bg\) var\(--r1-chrome-h\), transparent\)/);
    expect(band).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("is solid --bg when transparency is reduced, in both the attribute and the media forms", () => {
    expect(frame).toMatch(/:root\[data-transparency="reduce"\] \.r1-scroll-edge::before \{ background: var\(--bg\); \}/);
    expect(frame).toMatch(
      /@media \(prefers-reduced-transparency: reduce\) \{ :root:not\(\[data-transparency\]\) \.r1-scroll-edge::before \{ background: var\(--bg\); \} \}/,
    );
  });

  it("keys on the scrolled flag the Frame already maintains for the scroll column", () => {
    expect(edgeFade).toMatch(/node\.toggleAttribute\("data-top", node\.scrollTop > 0\)/);
  });

  it("retires the header-layer scrim, which could not paint under the thread row", () => {
    expect(frame).not.toMatch(/\.r1-header::before/);
    expect(glass).not.toMatch(/\.r1-header::before/);
    expect(glass).not.toMatch(/r1-conversation > \.r1-header/);
  });
});

describe("thread row (sticks right under the pill row, inside the band's solid part)", () => {
  it("sticks at the chrome's height less the thread row, and sits just below the chrome at rest", () => {
    expect(frame).toMatch(
      /:root:not\(#sg#sg#sg#sg\) \.r1-content > \.r1-topic-host \{ top: calc\(var\(--r1-chrome-h\) - var\(--r1-topic-row\)\); margin-top: calc\(-1 \* var\(--r1-topic-row\)\); \}/,
    );
  });
});

describe("shared scroll hook", () => {
  it("renders the scroll edge once, in the frame every conversation, place and Settings column shares", () => {
    expect(frameTsx.match(/className="r1-scroll-edge"/g)).toHaveLength(1);
  });
});
