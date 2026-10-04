// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tourCards, Walkthrough } from "./Walkthrough";
import { installedRows, WhatsNew } from "./WhatsNew";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
async function show(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(node));
  return host;
}

describe("walkthrough (§4.8.2)", () => {
  it("counts every card, moves with the arrows, holds toasts and ends on Escape", async () => {
    const closed = vi.fn();
    const host = await show(<Walkthrough defaultName="Sapling" onClose={closed} />);
    const n = tourCards("Sapling").length;
    expect(host.textContent).toContain(`1 of ${n}`);
    expect(document.documentElement.classList.contains("touring")).toBe(true);
    const layer = host.querySelector('[data-testid="walkthrough"]') as HTMLElement;
    await act(async () => layer.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(host.textContent).toContain(`2 of ${n}`);
    await act(async () => layer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(closed).toHaveBeenCalled();
    expect(tourCards("Sapling").some((c) => /example data|design notes|surface switcher/i.test(c.text))).toBe(false);
  });

  it("opens what each card shows, as the preview does, and ends on its own last card", async () => {
    const cards = tourCards("Sapling");
    const seen: { type: string; detail: unknown }[] = [];
    const listen = (e: Event) => seen.push({ type: e.type, detail: (e as CustomEvent).detail });
    addEventListener("branch:navigate-settings", listen);
    addEventListener("branch:navigate-place", listen);
    const host = await show(<Walkthrough defaultName="Sapling" onClose={() => {}} />);
    const layer = host.querySelector('[data-testid="walkthrough"]') as HTMLElement;
    for (let i = 1; i < cards.length; i++) await act(async () => layer.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    removeEventListener("branch:navigate-settings", listen);
    removeEventListener("branch:navigate-place", listen);
    expect(seen).toEqual([
      { type: "branch:navigate-settings", detail: { page: "local" } },
      { type: "branch:navigate-place", detail: { place: "customize", tab: "Channels" } },
      { type: "branch:navigate-settings", detail: { page: "appearance" } },
      { type: "branch:navigate-place", detail: { place: "people" } },
      { type: "branch:navigate-place", detail: { place: "automations", tab: "board" } },
      { type: "branch:navigate-place", detail: { place: "library", tab: "memory" } },
    ]);
    expect(host.querySelector(".tour-card b")?.textContent).toBe("That’s Branch");
    expect(host.querySelector(".tour-card p")?.textContent).toBe("That’s the walkthrough. Take it again any time from the Guide.");
    expect(host.querySelector('[data-testid="tour-end"]')?.textContent).toBe("Close");
  });
});

describe("What's new (§4.8.3)", () => {
  it("rows open their place; a waiting version lists the engine's notes and installs", async () => {
    const go = { setup: vi.fn(), shortcuts: vi.fn(), palette: vi.fn(), settings: vi.fn() };
    const install = vi.fn();
    const host = await show(<WhatsNew version="1.0" update={{ current: "1.0", latest: "1.1", notes: ["Faster start"], installing: false, waiting: null }} installed={installedRows(go)} onOpenUpdates={() => {}} onInstall={install} onClose={() => {}} />);
    const row = [...host.ownerDocument.querySelectorAll<HTMLButtonElement>(".new-row13")].find((b) => b.textContent?.includes("Setup and the walkthrough"));
    await act(async () => row?.click());
    expect(go.setup).toHaveBeenCalled();
    const ready = [...host.ownerDocument.querySelectorAll<HTMLButtonElement>(".wn-seg button")][1];
    await act(async () => ready.click());
    expect(host.ownerDocument.body.textContent).toContain("Faster start");
    await act(async () => host.ownerDocument.querySelector<HTMLButtonElement>('[data-testid="wn-install"]')?.click());
    expect(install).toHaveBeenCalled();
  });
});
