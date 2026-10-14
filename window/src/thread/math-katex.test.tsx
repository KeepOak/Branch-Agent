// @vitest-environment jsdom
// Maths in replies runs on a KaTeX that reads only its own settings: with Object.prototype polluted (KaTeX's own
// 0.18.2 regression case), \href stays text and never becomes a link, even though the window passes trust: false.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MathTex } from "./math";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Polluted = { processor?: unknown; trust?: unknown; default?: unknown };
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => {
  const proto = Object.prototype as Polluted;
  delete proto.processor; delete proto.trust; delete proto.default;
  await act(async () => root.unmount()); host.remove();
});

const LINK = String.raw`\href{javascript:alert(1)}{x}`;
// KaTeX loads on first use (a dynamic import), which can take seconds on a cold transform.
const settle = () => act(async () => { for (let i = 0; i < 400 && !host.querySelector(".md-math-i"); i++) await new Promise((r) => setTimeout(r, 50)); });

it("typesets maths with KaTeX", async () => {
  await act(async () => root.render(<MathTex tex="x^2" display={false} raw="$x^2$" />));
  await settle();
  expect(host.querySelector(".md-math-i")!.innerHTML).toContain("<math");
}, 30_000);

it("keeps \\href as text when Object.prototype carries a settings processor, trust or default", async () => {
  await act(async () => root.render(<MathTex tex="y" display={false} raw="$y$" />));
  await settle();
  const proto = Object.prototype as Polluted;
  proto.processor = () => true;
  proto.trust = true;
  proto.default = true;
  await act(async () => root.render(<MathTex tex={LINK} display={false} raw={`$${LINK}$`} />));
  const math = host.querySelector(".md-math-i");
  expect(math, "typeset, not left as TeX").not.toBeNull();
  expect(math!.innerHTML).not.toContain("<a ");
  expect(math!.querySelector("a")).toBeNull();
}, 30_000);
