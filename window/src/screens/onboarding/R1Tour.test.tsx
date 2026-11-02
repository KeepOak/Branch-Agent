// @vitest-environment jsdom
// Parity row 14: the R1 walkthrough re-hosts the Classic tour (shell/Walkthrough.tsx) as item 37's 3 cards, and the full tour.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tourCards, Walkthrough } from "../../shell/Walkthrough";
import { canShow, INTRO_CARDS, R1Tour } from "./R1Tour";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 0; });
  document.body.innerHTML = '<nav><section class="r1sb-sec" data-section="trunks"></section></nav><button class="r1sb-seed"></button><button class="r1sb-me"></button><textarea data-testid="composer"></textarea>';
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
const card = () => document.querySelector<HTMLElement>('[data-testid="walkthrough"] .tour-card')!;
const button = (text: string) => [...card().querySelectorAll("button")].find((b) => b.textContent === text)!;
const click = async (el: HTMLElement) => act(async () => { el.click(); });

it("after setup, shows the 3-card walkthrough on clear glass with its words on pills", async () => {
  await act(async () => root.render(<R1Tour kind="intro" defaultName="Sapling" onClose={() => {}} />));
  expect(card().classList).toContain("g-clear");
  expect(card().querySelector(".n")?.textContent).toBe("1 of 3");
  expect([...card().querySelectorAll(".n, b, p")].every((el) => el.classList.contains("g-label"))).toBe(true);
  const titles = [];
  for (let i = 0; i < 3; i++) { titles.push(card().querySelector("b")?.textContent); if (i < 2) await click(button("Next")); }
  expect(titles).toEqual(["Your Trunks", "Customize & Seedbank", "Settings, Guide & help"]);
  expect(INTRO_CARDS.map((c) => c.title)).toEqual(titles);
});

it("is skippable, and the card set ends in the message box", async () => {
  const onClose = vi.fn();
  await act(async () => root.render(<R1Tour kind="intro" defaultName="Sapling" onClose={onClose} />));
  await click(button("Skip the walkthrough"));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(document.querySelector('[data-testid="composer"]'));
});

type Rect = { left: number; top: number; width: number; height: number };
const hits = (a: Rect, b: Rect) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
const spot = () => document.querySelector<HTMLElement>(".tour-spot")!;
const hole = (): Rect => { const s = spot(); return { left: parseFloat(s.style.left), top: parseFloat(s.style.top), width: parseFloat(s.style.width), height: parseFloat(s.style.height) }; };
const place = (): Rect => {
  const node = card();
  return { left: parseFloat(node.style.left), top: parseFloat(node.style.top), width: Math.min(340, parseFloat(node.style.maxWidth) || 340), height: 220 };
};
/** A wide window right after setup: the R1 sidebar on the left, the Trunk's name in the header, the message box below. */
function layout() {
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("innerHeight", 900);
  document.body.querySelector("nav")?.remove();
  document.body.querySelector(".r1sb-seed")?.remove();
  document.body.querySelector(".r1sb-me")?.remove();
  document.body.querySelector('[data-testid="composer"]')?.remove();
  const side = document.body.appendChild(document.createElement("aside"));
  side.className = "r1-sidebar";
  side.innerHTML = '<section class="r1sb-sec" data-section="trunks"></section><button class="r1sb-seed"></button><button class="r1sb-me"></button>';
  const header = document.body.appendChild(document.createElement("header"));
  header.className = "r1-header";
  const pill = header.appendChild(document.createElement("button"));
  pill.className = "g-pill";
  pill.textContent = "Sapling";
  const composer = document.body.appendChild(document.createElement("textarea"));
  composer.dataset.testid = "composer";
  const box = (el: Element, x: number, y: number, w: number, h: number) => {
    const r = new DOMRect(x, y, w, h);
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(r);
    vi.spyOn(el, "getClientRects").mockReturnValue([r] as unknown as DOMRectList);
    return r;
  };
  const sidebar = box(side, 0, 0, 280, 900);
  box(side.querySelector(".r1sb-sec")!, 12, 120, 248, 180);
  const seed = box(side.querySelector(".r1sb-seed")!, 16, 760, 200, 36);
  const me = box(side.querySelector(".r1sb-me")!, 16, 820, 36, 36);
  const trunk = box(pill, 640, 18, 160, 36);
  box(composer, 360, 780, 640, 44);
  return { sidebar, seed, me, trunk };
}

it("after setup, each intro card spotlights where its thing lives", async () => {
  const { sidebar, seed, me, trunk } = layout();
  await act(async () => root.render(<R1Tour kind="intro" defaultName="Sapling" onClose={() => {}} />));
  expect(spot().classList.contains("none")).toBe(false);
  expect(hits(hole(), trunk)).toBe(true);
  expect(hits(hole(), sidebar)).toBe(false);
  expect(hits(place(), sidebar)).toBe(false);
  await click(button("Next"));
  expect(card().querySelector("b")?.textContent).toBe("Customize & Seedbank");
  expect(spot().classList.contains("none")).toBe(false);
  expect(hits(hole(), seed)).toBe(true);
  expect(hits(place(), hole())).toBe(false);
  await click(button("Next"));
  expect(card().querySelector("b")?.textContent).toBe("Settings, Guide & help");
  expect(card().querySelector("p")?.textContent).toBe("Everything has a home in Settings, and search finds anything. The Guide, in the menu on your name, takes you on the full tour any time.");
  expect(spot().classList.contains("none")).toBe(false);
  expect(hits(hole(), me)).toBe(true);
  expect(hits(place(), hole())).toBe(false);
  // Your Trunks marks the name in the header; the other two mark the Seedbank button and the menu on your name.
  expect(INTRO_CARDS.map((c) => c.target)).toEqual([".r1-header .g-pill", ".r1sb-seed", ".r1sb-me"]);
});

it("a card that does not opt in still gets no spotlight in the sidebar", async () => {
  layout();
  await act(async () => root.render(<Walkthrough clear defaultName="Sapling" cards={[{ title: "x", text: "", target: ".r1sb-seed" }]} onClose={() => {}} />));
  expect(spot().classList.contains("none")).toBe(true);
});

it("the full tour counts only the cards that can show in this window, so the counter never jumps", async () => {
  const all = tourCards("Sapling");
  const shown = all.filter((c) => canShow(c));
  expect(shown.length).toBeLessThan(all.length);
  expect(canShow({ title: "x", text: "", target: ".character-panel" })).toBe(false);
  expect(canShow({ title: "x", text: "", target: null })).toBe(true);
  await act(async () => root.render(<R1Tour kind="full" defaultName="Sapling" onClose={() => {}} />));
  expect(card().querySelector(".n")?.textContent).toBe(`1 of ${shown.length}`);
  expect(card().querySelectorAll(".tour-dots i")).toHaveLength(shown.length);
  expect(card().querySelector("b")?.textContent).toBe(shown[0].title);
});
