// @vitest-environment jsdom
// The walkthrough card and the mascots as they are on screen: the pet keeps walking while the card shows, and a
// Trunk's face that is scrolled under the header or covered by a bar is not kept clear (the card keeps its full height).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Walkthrough } from "./Walkthrough";
import { coachCardPlace, overlaps, type Box } from "./walkthrough-place";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEFAULT = { width: 1280, height: 840 };
const SMALLEST = { width: 400, height: 300 };
const rect = (b: Box) => new DOMRect(b.left, b.top, b.width, b.height);
const cards = [{ title: "Your Trunks", text: "Chat with each Trunk like a teammate.", target: ".r1-header .g-pill" }];

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function windowOf(view: { width: number; height: number }) {
  vi.stubGlobal("innerWidth", view.width);
  vi.stubGlobal("innerHeight", view.height);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 0; });
}

function namePill(box: Box) {
  const header = document.body.appendChild(document.createElement("header"));
  header.className = "r1-header";
  const pill = header.appendChild(document.createElement("button"));
  pill.className = "g-pill";
  vi.spyOn(pill, "getBoundingClientRect").mockReturnValue(rect(box));
  vi.spyOn(pill, "getClientRects").mockReturnValue([rect(box)] as unknown as DOMRectList);
}

async function show(): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Walkthrough clear defaultName="Sapling" onClose={() => {}} cards={cards} />));
  // the card is placed again a moment after it opens; let that happen before anything moves
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20));
  });
  return host.querySelector<HTMLElement>(".tour-card")!;
}

/** The card as drawn: jsdom has no layout, so Walkthrough measures it at its 340 x 200 stand-in size. */
function cardBox(el: HTMLElement): Box {
  const maxHeight = parseFloat(el.style.maxHeight) || 200;
  return { top: parseFloat(el.style.top) || 0, left: parseFloat(el.style.left) || 0, width: Math.min(340, parseFloat(el.style.maxWidth) || 340), height: Math.min(200, maxHeight) };
}

describe("walkthrough card and the walking pet", () => {
  function pet(start: Box) {
    const rim = document.body.appendChild(document.createElement("div"));
    rim.className = "r1-pet-rim";
    const keeper = rim.appendChild(document.createElement("div"));
    keeper.className = "keeper";
    const box = keeper.appendChild(document.createElement("div"));
    box.className = "petbox";
    let at = start;
    vi.spyOn(box, "getBoundingClientRect").mockImplementation(() => rect(at));
    return async (to: Box, x: number) => {
      at = to;
      await act(async () => {
        box.style.transform = "translateX(" + x + "px)";
        await Promise.resolve();
      });
    };
  }

  it("moves the card off the pet when the pet walks into it after the card was placed", async () => {
    windowOf(DEFAULT);
    namePill({ left: 732, top: 8, width: 108, height: 36 });
    const walk = pet({ left: 400, top: 760, width: 44, height: 44 });
    const el = await show();
    const before = cardBox(el);
    const into: Box = { left: before.left + 150, top: before.top + 80, width: 44, height: 44 };
    expect(overlaps(before, into)).toBe(true);
    await walk(into, 600);
    const after = cardBox(el);
    expect(overlaps(after, into)).toBe(false);
    expect(after.top + after.height).toBeLessThanOrEqual(DEFAULT.height);
  });

  it("keeps the card off the pet's next step too", async () => {
    windowOf(DEFAULT);
    namePill({ left: 732, top: 8, width: 108, height: 36 });
    const walk = pet({ left: 400, top: 760, width: 44, height: 44 });
    const el = await show();
    const before = cardBox(el);
    await walk({ left: before.left + before.width - 20, top: before.top + 80, width: 44, height: 44 }, 600);
    const after = cardBox(el);
    const nextStep: Box = { left: before.left + before.width - 32, top: before.top + 80, width: 68, height: 44 };
    expect(overlaps(after, nextStep)).toBe(false);
  });

  it("leaves the card where it is while the pet walks somewhere else", async () => {
    windowOf(DEFAULT);
    namePill({ left: 732, top: 8, width: 108, height: 36 });
    const walk = pet({ left: 400, top: 760, width: 44, height: 44 });
    const el = await show();
    const before = cardBox(el);
    await walk({ left: 460, top: 760, width: 44, height: 44 }, 60);
    expect(cardBox(el)).toEqual(before);
  });
});

describe("a card with no room beside the pet", () => {
  it("keeps its full height and its usual spot instead of hiding its buttons (smallest size)", () => {
    // The name pill's spotlight and the pet on the composer's rim, as the smallest window draws them.
    const spot: Box = { left: 173, top: 2, width: 54, height: 48 };
    const petLane: Box = { left: 182, top: 164, width: 72, height: 40 };
    const card = { width: 340, height: 197 };
    const place = coachCardPlace(spot, card, SMALLEST, null, [petLane]);
    expect(place.maxHeight === undefined || place.maxHeight >= 150).toBe(true);
    expect(place).toEqual(coachCardPlace(spot, card, SMALLEST, null));
  });
});

describe("walkthrough card and a face that doesn't show", () => {
  const pillBox: Box = { left: 179, top: 8, width: 42, height: 36 };
  const faceBox: Box = { left: 164, top: 54, width: 72, height: 72 };

  function face(parent: HTMLElement = document.body) {
    const empty = parent.appendChild(document.createElement("div"));
    empty.dataset.testid = "empty-chat";
    const el = empty.appendChild(document.createElement("span"));
    el.className = "pebble";
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(rect(faceBox));
    return el;
  }

  function onTop(pick: (x: number, y: number) => Element[]) {
    Object.defineProperty(document, "elementsFromPoint", { value: pick, configurable: true, writable: true });
  }

  it("keeps a full-height card when a bar covers most of the face (smallest size)", async () => {
    windowOf(SMALLEST);
    namePill(pillBox);
    const el = face();
    const bar = document.body.appendChild(document.createElement("nav"));
    onTop((_x, y) => (y < 100 ? [bar, document.body] : [el, document.body]));
    const card = await show();
    expect(card.style.maxHeight).toBe("");
    expect(card.classList.contains("tight")).toBe(false);
  });

  it("keeps a full-height card when the face is mostly scrolled out of its list (smallest size)", async () => {
    windowOf(SMALLEST);
    namePill(pillBox);
    const list = document.body.appendChild(document.createElement("div"));
    list.style.overflow = "auto";
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue(rect({ left: 0, top: 0, width: 400, height: 80 }));
    const el = face(list);
    onTop(() => [el, document.body]);
    const card = await show();
    expect(card.style.maxHeight).toBe("");
    expect(card.classList.contains("tight")).toBe(false);
  });

  it("still keeps the card off a face that shows (smallest size)", async () => {
    windowOf(SMALLEST);
    namePill(pillBox);
    const el = face();
    onTop(() => [el, document.body]);
    const card = await show();
    expect(overlaps(cardBox(card), faceBox)).toBe(false);
    expect(card.classList.contains("tight")).toBe(true);
    expect(parseFloat(card.style.maxHeight)).toBeGreaterThanOrEqual(150);
  });

  it("counts the face as showing under the walkthrough's own layer", async () => {
    windowOf(SMALLEST);
    namePill(pillBox);
    const el = face();
    onTop(() => {
      const layer = document.querySelector(".tour-layer");
      return layer ? [layer, el, document.body] : [el, document.body];
    });
    const card = await show();
    expect(overlaps(cardBox(card), faceBox)).toBe(false);
  });
});
