// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Walkthrough } from "./Walkthrough";
import { coachCardPlace, type Box } from "./walkthrough-place";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const view = { width: 1440, height: 900 };
const card = { width: 340, height: 220 };
const sidebar: Box = { top: 0, left: 0, width: 280, height: 900 };

function overlaps(place: { top: number; left: number; maxWidth: number }, zone: Box, size = card): boolean {
  const width = Math.min(size.width, place.maxWidth);
  const height = size.height;
  return place.left < zone.left + zone.width && place.left + width > zone.left
    && place.top < zone.top + zone.height && place.top + height > zone.top;
}

describe("coach card placement", () => {
  it("stays off the sidebar and off a control inside it", () => {
    const target: Box = { top: 120, left: 16, width: 248, height: 48 };
    const place = coachCardPlace(target, card, view, sidebar);
    expect(overlaps(place, sidebar)).toBe(false);
    expect(overlaps(place, target)).toBe(false);
    expect(place.left).toBeGreaterThanOrEqual(sidebar.left + sidebar.width);
  });

  it("stays off the sidebar and off a control in the conversation", () => {
    const target: Box = { top: 640, left: 480, width: 180, height: 40 };
    const place = coachCardPlace(target, card, view, sidebar);
    expect(overlaps(place, sidebar)).toBe(false);
    expect(overlaps(place, target)).toBe(false);
  });

  it("stays off the control when the window has no sidebar", () => {
    const target: Box = { top: 40, left: 40, width: 220, height: 36 };
    const place = coachCardPlace(target, card, view, null);
    expect(overlaps(place, target)).toBe(false);
  });

  it("keeps a card with no control off the sidebar", () => {
    const place = coachCardPlace(null, card, view, sidebar);
    expect(overlaps(place, sidebar)).toBe(false);
    expect(place.left).toBeGreaterThanOrEqual(sidebar.left + sidebar.width);
  });
});

describe("walkthrough card", () => {
  let root: Root | undefined;
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("draws the card beside the sidebar instead of on the control it points at", async () => {
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("innerHeight", 900);
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 0; });
    const side = document.body.appendChild(document.createElement("aside"));
    side.dataset.testid = "sidebar";
    const target = document.body.appendChild(document.createElement("button"));
    target.dataset.testid = "conversation-list";
    const sideRect = new DOMRect(0, 0, 280, 900);
    const targetRect = new DOMRect(16, 120, 248, 48);
    vi.spyOn(side, "getBoundingClientRect").mockReturnValue(sideRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(targetRect);
    vi.spyOn(target, "getClientRects").mockReturnValue([targetRect] as unknown as DOMRectList);
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<Walkthrough defaultName="Sapling" onClose={() => {}} cards={[{ title: "Your Trunks", text: "Each Trunk is one job.", target: "[data-testid=conversation-list]" }]} />));
    const drawn = host.querySelector<HTMLElement>(".tour-card")!;
    const left = parseFloat(drawn.style.left);
    const top = parseFloat(drawn.style.top);
    const width = Math.min(340, parseFloat(drawn.style.maxWidth) || 340);
    const drawnBox = { left, top, width, height: 220 };
    const covers = (zone: DOMRect) => drawnBox.left < zone.right && drawnBox.left + drawnBox.width > zone.left && drawnBox.top < zone.bottom && drawnBox.top + drawnBox.height > zone.top;
    expect(covers(sideRect)).toBe(false);
    expect(covers(targetRect)).toBe(false);
  });
});
