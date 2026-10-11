// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu } from "./Menu";
import { guideMenuItems } from "./guide-menu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("DA-100 Guide menu", () => {
  it("offers only Walkthrough, Docs and Ask for help and closes before opening each destination", async () => {
    const tour = vi.fn();
    const open = vi.fn();
    const close = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<Menu at={{ x: 10, y: 10 }} label="Guide" items={guideMenuItems(tour, open)} onClose={close} />));
    const items = [...host.querySelectorAll<HTMLButtonElement>('[role=menuitem]')];
    expect(items.map(item => item.textContent)).toEqual([
      "Walkthrough", "Docs (opens in browser)", "Ask for helpopens in browser",
    ]);
    expect(items.every(item => !item.disabled)).toBe(true);
    await act(async () => items[0].click());
    expect(tour).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    await act(async () => items[1].click());
    await act(async () => items[2].click());
    expect(open.mock.calls).toEqual([["https://keepoak.com/help"], ["https://keepoak.com/help"]]);
    expect(close).toHaveBeenCalledTimes(3);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(tour.mock.invocationCallOrder[0]);
    expect(close.mock.invocationCallOrder[1]).toBeLessThan(open.mock.invocationCallOrder[0]);
    expect(close.mock.invocationCallOrder[2]).toBeLessThan(open.mock.invocationCallOrder[1]);
  });

  it("wires the shell to the tested menu, walkthrough and safe external opener", () => {
    const source = readFileSync(join(process.cwd(), "src/shell/WindowShell.tsx"), "utf8");
    expect(source).toContain('import { guideMenuItems } from "./guide-menu"');
    expect(source).toContain('guideMenuItems(\n    () => { setOverlay(null); setGuide("tour"); },');
    expect(source).toContain('window.open(url, "_blank", "noopener")');
  });
});
