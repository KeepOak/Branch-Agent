// @vitest-environment jsdom
// The dialogs the Classic shell mounts for the whole window, re-hosted for R1: a Settings "Show me" (branch:ckpt-show)
// must open the save-progress offer here, or the control has no visible result. Fails on main, where R1 never mounted it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { CKPT_SHOW } from "../../shell/SaveProgress";
import { R1ExtraDialogs } from "./R1ExtraDialogs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function engineStub() {
  return { request: vi.fn(async () => ({})), onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: [], events: [] } } as unknown as WindowEngine;
}

describe("R1 extra dialogs", () => {
  it("opens the save-progress offer when Settings asks to show it", async () => {
    await act(async () => root.render(<R1ExtraDialogs engine={engineStub()} ready limits={null} working={[]} />));
    expect(host.querySelector('[role="alertdialog"][aria-label="Save progress?"]')).toBeNull();
    await act(async () => { window.dispatchEvent(new CustomEvent(CKPT_SHOW)); });
    expect(host.querySelector('[role="alertdialog"][aria-label="Save progress?"]')).not.toBeNull();
  });
});
