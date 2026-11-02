// @vitest-environment jsdom
// The first-run walkthrough card keeps off the mascot (the Trunk's face on the empty first conversation) at the
// window's default size (1280 x 840) and at its smallest (400 x 300). The boxes are the ones the real first-run screen
// draws at those sizes: the Trunk's name pill in the header, the face under it and the sidebar.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Walkthrough } from "./Walkthrough";
import { coachCardPlace, overlaps, type Box } from "./walkthrough-place";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const card = { width: 340, height: 197 };
const SIZES = [
  {
    name: "default",
    view: { width: 1280, height: 840 },
    sidebar: { left: 0, top: 0, width: 292, height: 840 } as Box | null,
    pill: { left: 732, top: 8, width: 108, height: 36 },
    face: { left: 750, top: 238, width: 72, height: 72 },
  },
  {
    name: "smallest",
    view: { width: 400, height: 300 },
    sidebar: null,
    pill: { left: 179, top: 8, width: 42, height: 36 },
    face: { left: 164, top: 54, width: 72, height: 72 },
  },
];

/** The spotlight box Walkthrough draws around a control: 6 px around it. */
const spot = (b: Box): Box => ({ left: b.left - 6, top: b.top - 6, width: b.width + 12, height: b.height + 12 });

/** The card as drawn: its width up to maxWidth, its height up to maxHeight. */
function drawn(place: { top: number; left: number; maxWidth: number; maxHeight?: number }, size = card): Box {
  return { top: place.top, left: place.left, width: Math.min(size.width, place.maxWidth), height: Math.min(size.height, place.maxHeight ?? size.height) };
}

describe("walkthrough card and the mascot", () => {
  for (const s of SIZES) {
    it("keeps the first card off the mascot and off the name pill at the " + s.name + " size", () => {
      const place = coachCardPlace(spot(s.pill), card, s.view, s.sidebar, [s.face]);
      const box = drawn(place);
      expect(overlaps(box, s.face)).toBe(false);
      expect(overlaps(box, spot(s.pill))).toBe(false);
      if (s.sidebar) expect(overlaps(box, s.sidebar)).toBe(false);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top + box.height).toBeLessThanOrEqual(s.view.height);
      expect(box.left + box.width).toBeLessThanOrEqual(s.view.width);
    });

    it("keeps a card whose control is off screen off the mascot at the " + s.name + " size", () => {
      const box = drawn(coachCardPlace(null, card, s.view, s.sidebar, [s.face]));
      expect(overlaps(box, s.face)).toBe(false);
      expect(box.top + box.height).toBeLessThanOrEqual(s.view.height);
    });
  }

  it("leaves a card that already clears the mascot where it was", () => {
    const s = SIZES[0];
    const far: Box = { left: 1180, top: 700, width: 72, height: 72 };
    expect(coachCardPlace(spot(s.pill), card, s.view, s.sidebar, [far])).toEqual(coachCardPlace(spot(s.pill), card, s.view, s.sidebar));
  });
});

describe("walkthrough card on the first-run screen", () => {
  let root: Root | undefined;
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  for (const s of SIZES) {
    it("draws the card off the empty conversation's face at the " + s.name + " size", async () => {
      vi.stubGlobal("innerWidth", s.view.width);
      vi.stubGlobal("innerHeight", s.view.height);
      vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 0; });
      const rect = (b: Box) => new DOMRect(b.left, b.top, b.width, b.height);
      if (s.sidebar) {
        const side = document.body.appendChild(document.createElement("aside"));
        side.className = "r1-sidebar";
        vi.spyOn(side, "getBoundingClientRect").mockReturnValue(rect(s.sidebar));
      }
      const header = document.body.appendChild(document.createElement("header"));
      header.className = "r1-header";
      const pill = header.appendChild(document.createElement("button"));
      pill.className = "g-pill";
      vi.spyOn(pill, "getBoundingClientRect").mockReturnValue(rect(s.pill));
      vi.spyOn(pill, "getClientRects").mockReturnValue([rect(s.pill)] as unknown as DOMRectList);
      const empty = document.body.appendChild(document.createElement("div"));
      empty.dataset.testid = "empty-chat";
      const face = empty.appendChild(document.createElement("span"));
      face.className = "pebble";
      vi.spyOn(face, "getBoundingClientRect").mockReturnValue(rect(s.face));
      const host = document.body.appendChild(document.createElement("div"));
      root = createRoot(host);
      await act(async () => root?.render(<Walkthrough clear defaultName="Sapling" onClose={() => {}} cards={[{ title: "Your Trunks", text: "Chat with each Trunk like a teammate.", target: ".r1-header .g-pill" }]} />));
      const el = host.querySelector<HTMLElement>(".tour-card")!;
      // jsdom has no layout: Walkthrough measures the card at its 340 x 200 stand-in size.
      const box = drawn({
        top: parseFloat(el.style.top) || 0,
        left: parseFloat(el.style.left) || 0,
        maxWidth: parseFloat(el.style.maxWidth) || 340,
        maxHeight: parseFloat(el.style.maxHeight) || undefined,
      }, { width: 340, height: 200 });
      expect(overlaps(box, s.face)).toBe(false);
      expect(box.top + box.height).toBeLessThanOrEqual(s.view.height);
      expect(el.classList.contains("tight")).toBe(Boolean(el.style.maxHeight));
    });
  }
});
