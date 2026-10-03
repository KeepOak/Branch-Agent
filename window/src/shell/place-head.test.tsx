// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaceHead } from "./TopBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("a place's narrow header row (preview placeHead)", () => {
  it("has the list button and the Settings gear, and each runs its own action", async () => {
    const onList = vi.fn();
    const onSettings = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<PlaceHead onList={onList} onSettings={onSettings} />));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("[data-testid=place-head] button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Show conversations", "Settings"]);
    await act(async () => buttons[0]?.click());
    expect(onList).toHaveBeenCalledTimes(1);
    expect(onSettings).not.toHaveBeenCalled();
    await act(async () => buttons[1]?.click());
    expect(onSettings).toHaveBeenCalledTimes(1);
  });
});
