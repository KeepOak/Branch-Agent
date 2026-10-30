// @vitest-environment jsdom
// Route tests: each Settings button that opens a place or a tab of one must send the place and the tab it names.
// A tab that is dropped on the way lands the person on the place's first tab (the Customize Trunks list).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { openFeature } from "../../screens/settings/pages/places-live";
import type { FeatureHome } from "../../screens/features/atlas";
import { HOME } from "../../screens/features/atlas";
import { AdvancedPage } from "./set2/advanced";
import { UpdatesPage } from "./set2/updates";
import { UsagePage } from "./set2/usage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); });

/** Every engine read answers an empty object, so the pages draw their controls. */
const engine = { request: vi.fn(async () => ({})), onEvent: () => () => undefined, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

/** The navigate-place requests the window hears while `click` runs. */
async function requestsFrom(click: () => void): Promise<unknown[]> {
  const heard: unknown[] = [];
  const listen = (event: Event) => heard.push((event as CustomEvent).detail);
  window.addEventListener("branch:navigate-place", listen);
  await act(async () => click());
  window.removeEventListener("branch:navigate-place", listen);
  return heard;
}
function buttonNamed(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

describe("Settings buttons that open a place's tab", () => {
  it("Data & usage: Manage plugins opens Customize on Plugins", async () => {
    await act(async () => root.render(<UsagePage page="usage" title="Data & usage" level="advanced" engine={engine} />));
    await flush();
    expect(await requestsFrom(() => buttonNamed("Manage plugins").click())).toEqual([{ place: "customize", tab: "Plugins" }]);
  });

  it("Updates: Open Plugins opens Customize on Plugins", async () => {
    await act(async () => root.render(<UpdatesPage page="updates" title="Updates & about" level="regular" engine={engine} />));
    await flush();
    expect(await requestsFrom(() => buttonNamed("Open Plugins").click())).toEqual([{ place: "customize", tab: "Plugins" }]);
  });

  it("Updates: Browse the skill library opens Customize on Skills", async () => {
    await act(async () => root.render(<UpdatesPage page="updates" title="Updates & about" level="regular" engine={engine} />));
    await flush();
    expect(await requestsFrom(() => buttonNamed("Browse the skill library").click())).toEqual([{ place: "customize", tab: "Skills" }]);
  });

  it("Advanced: Open Plugins opens Customize on Plugins", async () => {
    await act(async () => root.render(<AdvancedPage page="advanced" title="Advanced" level="advanced" engine={engine} />));
    await flush();
    expect(await requestsFrom(() => buttonNamed("Open Plugins").click())).toEqual([{ place: "customize", tab: "Plugins" }]);
  });
});

describe("All features: Open goes to the tab the feature names", () => {
  it("a Customize feature home sends its tab", async () => {
    const go = vi.fn();
    const heard = await requestsFrom(() => openFeature(HOME.tools as FeatureHome, go));
    expect(heard).toEqual([{ place: "customize", tab: "Tools" }]);
    expect(go).not.toHaveBeenCalled();
  });

  it("the Tools, Integrations and Coding features all open Customize on Tools", () => {
    for (const id of ["tools", "integrations", "coding"]) expect(HOME[id]).toEqual({ kind: "place", place: "customize", tab: "Tools" });
  });

  it("a Settings feature home still routes to its Settings page", () => {
    const go = vi.fn();
    openFeature({ kind: "settings", page: "voice" }, go);
    expect(go).toHaveBeenCalledWith({ kind: "settings", page: "voice" });
  });
});
