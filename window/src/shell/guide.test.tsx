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
