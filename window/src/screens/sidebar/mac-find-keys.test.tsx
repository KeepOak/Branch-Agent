// @vitest-environment jsdom
// On a Mac only ⌘K opens Find anything, so every hint for it reads ⌘K there. Windows and Linux keep Ctrl K.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { tourCards } from "../../shell/Walkthrough";
import { installedRows } from "../../shell/WhatsNew";
import { placePages } from "../settings/pages/places-live";
import { ShortcutButtons } from "../settings/pages/updates-live";
import { TopCapsules } from "./parts";

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
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const on = (platform: string) => vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
const engine = { request: async () => ({}), onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: ["sessions.search"], events: [] } } as unknown as WindowEngine;
const noop = () => {};

async function drawSidebarSearch() {
  await act(async () => root.render(<TopCapsules query="" onQuery={noop} searchRef={{ current: null }} onSettings={noop} onGrove={noop} plusRef={{ current: null }} onPlus={noop} plusDot={false} engine={engine} />));
  const label = host.querySelector(".r1sb-search");
  return { kbd: label?.querySelector("kbd")?.textContent, title: label?.getAttribute("title") };
}

async function drawFindButton() {
  await act(async () => root.render(<ShortcutButtons engine={engine} row={{} as never} />));
  return [...host.querySelectorAll("button")].map((b) => b.textContent?.replace(/\s+/g, " ").trim()).find((t) => t?.startsWith("Find anything"));
}

async function drawGoToLede() {
  const GoTo = placePages(noop).goto?.component;
  if (!GoTo) throw new Error("Go to has no page");
  await act(async () => root.render(<GoTo engine={engine} />));
  return host.querySelector(".r1s-lede")?.textContent;
}

const lines = () => [
  tourCards("Juniper").find((c) => c.title === "Search everything")?.text,
  installedRows({ setup: noop, shortcuts: noop, palette: noop, settings: noop }).Better.find((r) => r.title === "Find anything")?.line,
];

describe("Find anything hints on a Mac", () => {
  it("the sidebar search reads ⌘K, in its key cap and its tooltip", async () => {
    on("MacIntel");
    expect(await drawSidebarSearch()).toEqual({ kbd: "⌘K", title: "Search · ⌘K" });
    expect(host.textContent).not.toMatch(/Ctrl/);
  });

  it("the Find anything button in Settings reads ⌘K", async () => {
    on("MacIntel");
    expect(await drawFindButton()).toBe("Find anything ⌘K");
  });

  it("Go to, the walkthrough and What's new say ⌘K", async () => {
    on("MacIntel");
    expect(await drawGoToLede()).toBe("Every page in Branch, in one place. Each also opens from ⌘K.");
    for (const line of lines()) {
      expect(line).toContain("⌘K");
      expect(line).not.toMatch(/Ctrl/);
    }
  });

  it("the pet's tip, the badge and the settings search row written when the window loads say ⌘K", async () => {
    on("MacIntel");
    vi.resetModules();
    const { BADGES } = await import("../../places/settings/set2/achievements");
    const { ELSE } = await import("../../places/settings/set2/advanced");
    const { petWords } = await import("../../shell/SidebarPet");
    expect(petWords(null, 60000)).toBe("⌘K finds anything, even settings.");
    expect(BADGES.find((b) => b.name === "Found the palette")?.desc).toBe("Open Find anything with ⌘K.");
    expect(ELSE.rows.map((r) => r.t)).toContain("⌘K to find anything");
  });
});

describe("Find anything hints on Windows and Linux", () => {
  it.each(["Win32", "Linux x86_64"])("%s keeps Ctrl K everywhere", async (platform) => {
    on(platform);
    expect(await drawSidebarSearch()).toEqual({ kbd: "Ctrl K", title: "Search · Ctrl K" });
    expect(await drawFindButton()).toBe("Find anything Ctrl K");
    for (const line of lines()) expect(line).toContain("Ctrl K");
    expect(await drawGoToLede()).toBe("Every page in Branch, in one place. Each also opens from Ctrl K.");
  });
});
