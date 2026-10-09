// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeaderRow, PlaceHead } from "./TopBar";

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
  it("has the list button and the Settings gear, and each runs its own action", async () => {
    const onList = vi.fn();
    const onSettings = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<PlaceHead onList={onList} onSettings={onSettings} />));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("[data-testid=place-head] button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Back", "Forward", "Show conversations", "Settings"]);
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[0]?.title).toBe("No earlier page in this window.");
    expect(buttons[1]?.disabled).toBe(true);
    expect(buttons[1]?.title).toBe("No later page in this window.");
    await act(async () => buttons[2]?.click());
    expect(onList).toHaveBeenCalledTimes(1);
    expect(onSettings).not.toHaveBeenCalled();
    await act(async () => buttons[3]?.click());
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it("enables available history actions without changing list or Settings actions", async () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onList = vi.fn();
    const onSettings = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<PlaceHead onList={onList} onSettings={onSettings} onBack={onBack} onForward={onForward} />));
    const back = host.querySelector<HTMLButtonElement>('[aria-label="Back"]')!;
    const forward = host.querySelector<HTMLButtonElement>('[aria-label="Forward"]')!;
    expect(back.disabled).toBe(false);
    expect(forward.disabled).toBe(false);
    expect(back.title).toBe("Back");
    expect(forward.title).toBe("Forward");
    await act(async () => { back.click(); forward.click(); });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onForward).toHaveBeenCalledTimes(1);
    expect(onList).not.toHaveBeenCalled();
    expect(onSettings).not.toHaveBeenCalled();
    await act(async () => root?.render(<PlaceHead onList={onList} onSettings={onSettings} onForward={onForward} />));
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.title).toBe("No earlier page in this window.");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Forward"]')?.disabled).toBe(false);
  });
});
