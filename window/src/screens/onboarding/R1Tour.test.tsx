// @vitest-environment jsdom
// Parity row 14: the R1 walkthrough re-hosts the Classic tour (shell/Walkthrough.tsx) as item 37's 3 cards, and the full tour.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tourCards } from "../../shell/Walkthrough";
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
