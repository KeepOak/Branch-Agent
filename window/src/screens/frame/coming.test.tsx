// @vitest-environment jsdom
// R1-10 for the frame: the header pill, the Computer / Browser / ••• capsule and the frame's own controls either name the
// engine call they need (and are Coming without it) or say they are local.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import { Frame } from "./Frame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const engineOf = (methods: string[]) => ({ features: { methods, events: [] } }) as unknown as WindowEngine;
const render = (engine: WindowEngine, onOpen?: () => void) => act(async () => root.render(
  <Frame sidebar={<span />} main={<p>Empty</p>} header={{ title: "Scout", onOpen, engine, canBack: true, onBack: () => undefined }} />));
const undeclared = () => undeclaredControls(host).map((el) => el.getAttribute("aria-label") || el.textContent?.trim() || el.tagName);

it("declares every frame control against an engine with no methods, and names the calls it waits for", async () => {
  const onOpen = vi.fn();
  await render(engineOf([]), onOpen);
  // The narrow drawer and its scrim are open, so every frame control is in the DOM.
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Toggle sidebar"]')!.click());
  expect(host.querySelector(".r1-drawer-scrim")).not.toBeNull();
  expect(undeclared()).toEqual([]);
  const needs = comingControls().flatMap((entry) => entry.need);
  expect(needs).toEqual(expect.arrayContaining(["agent.identity.get", "computer.status", "browser.request", "sessions.github.status"]));
  const pill = host.querySelector<HTMLButtonElement>(".g-pill")!;
  expect(pill.getAttribute("aria-disabled")).toBe("true");
  await act(async () => pill.click());
  expect(onOpen).not.toHaveBeenCalled();
});

it("keeps the pill live once the engine offers agent.identity.get, and the unwired tools still Coming", async () => {
  const onOpen = vi.fn();
  await render(engineOf(["agent.identity.get", "computer.status", "browser.request", "sessions.github.status"]), onOpen);
  const pill = host.querySelector<HTMLButtonElement>(".g-pill")!;
  expect(pill.getAttribute("aria-disabled")).toBeNull();
  expect(pill.dataset.need).toBe("agent.identity.get");
  await act(async () => pill.click());
  expect(onOpen).toHaveBeenCalledOnce();
  // The header tools have nothing to run yet: Coming, still naming their calls.
  for (const tool of host.querySelectorAll<HTMLButtonElement>(".r1-header-right button")) expect(tool.getAttribute("aria-disabled")).toBe("true");
  expect(comingControls().map((entry) => entry.where)).toEqual(expect.arrayContaining(["Computer", "Browser", "More"]));
  expect(undeclared()).toEqual([]);
});
