import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { inline } from "./markdown";
import { INLINE_MATH, readInlineMath } from "./math";

const render = (text: string, math = true) => renderToStaticMarkup(<>{inline(text, math)}</>);

describe("saved transcript inline rendering with maths enabled", () => {
  it("renders ordinary formatted history without an undefined split capture", () => {
    expect(render("Run **tests** with `node`, then read *results*."))
      .toBe("Run <strong>tests</strong> with <code>node</code>, then read <em>results</em>.");
  });

  it("keeps both math delimiters in their original form while KaTeX loads", () => {
    expect(render("Use $x^2$ and \\(y+1\\)."))
      .toBe('Use <code class="md-tex">$x^2$</code> and <code class="md-tex">\\(y+1\\)</code>.');
    expect(readInlineMath("\\(y+1\\)")).toBe("y+1");
  });

  it("does not add nested capture slots to the shared split expression", () => {
    expect("Before \\(x\\) after".split(INLINE_MATH))
      .toEqual(["Before ", "\\(x\\)", " after"]);
  });

  it("preserves dollar amounts and unmatched mathematical delimiters as text", () => {
    expect(render("Pay $5 and $6. Leave \\(unfinished as written."))
      .toBe("Pay $5 and $6. Leave \\(unfinished as written.");
  });

  it("renders links and adjacent formulas without dropping text", () => {
    expect(render("**Check** $x$ at [docs](https://example.com)."))
      .toBe('<strong>Check</strong> <code class="md-tex">$x$</code> at <a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>.');
  });

  it("preserves disabled-math formatting and literal mathematical text", () => {
    expect(render("**Check** $x$ and \\(y\\).", false))
      .toBe('<strong>Check</strong> $x$ and \\(y\\).');
  });
});
