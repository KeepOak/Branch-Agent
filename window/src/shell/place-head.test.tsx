// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeaderRow, PlaceHead, TopBar } from "./TopBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("announces the narrow header's shared Trunk state politely", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<HeaderRow header={{ name: "Fern", trunkName: "Fern", state: "oops", isDefaultTrunk: false, renaming: false, onRename: () => {} }} />));
  expect(host.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Fern: Fern · ready");
  expect(host.querySelector('.head-state[data-face-state="oops"]')?.textContent).toBe("Fern · ready");
});

describe("a place's narrow header row (preview placeHead)", () => {
  it("keeps list navigation without a duplicate Settings gear", async () => {
    const onList = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<PlaceHead onList={onList} />));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("[data-testid=place-head] button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Show conversations"]);
    await act(async () => buttons[0]?.click());
    expect(onList).toHaveBeenCalledTimes(1);
  });
});

it("keeps Settings out of the wide place header", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const legacyProps = { onSettings: vi.fn() };
  await act(async () => root?.render(<TopBar {...legacyProps} compact={false} machine={null} header={null} dark={false} listHidden={false} onToggleList={() => {}} />));
  expect(host.querySelector('[aria-label="Settings"]')).toBeNull();
});
