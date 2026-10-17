// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import { Seedbank } from "./index";
import { parseSeed, SEED_KIND_COMING, SEED_KIND_UNKNOWN } from "./seed";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; localStorage.clear(); });
// The Settings "How much to show" level (places-nav/level.ts). Coming controls and later-update lines are Technical only.
const at = (level: "regular" | "advanced" | "technical") => localStorage.setItem("branch.level", level);
const LATER = /later update/i;

type Handler = (method: string, params: unknown) => unknown;
function engineOf(methods: string[], handler: Handler = () => ({})) {
  const request = vi.fn(async (method: string, params?: unknown) => {
    const value = handler(method, params);
    if (value instanceof Error) throw value;
    return value;
  });
  return { engine: { features: { methods, events: [] }, request, onEvent: () => () => {}, send: async () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine, request };
}
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
async function render(engine: WindowEngine, node = <Seedbank engine={engine} />) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<CapabilityProvider engine={engine}>{node}</CapabilityProvider>));
  await settle();
  return host;
}
const buttons = (scope: ParentNode, text: string) => [...scope.querySelectorAll("button")].filter(b => b.textContent?.trim() === text);
const click = async (el: Element) => { await act(async () => (el as HTMLElement).click()); await settle(); };

// Fixture apps are from the preview's curated catalogue, so R1's curated Seedbank (#1542) keeps them.
// #1049 section F: the item dialog, seeds on every card as a short link, and Who gets it for connectors and plugins.
const BROWSE = { items: [
  { id: "github", catalog: { name: "GitHub", author: "Ada", summary: "Repos, issues, pull requests.", packageName: "@ada/github", categories: ["integrations"] }, local: { installed: false } },
  { id: "brave-search", catalog: { name: "Brave web search", author: "Bo", summary: "Searches the web.", packageName: "@bo/brave-search", categories: ["search"] }, local: { installed: false } },
] };
const THEMES = { current: { id: "grove" }, themes: [{ id: "grove", name: "Branch Slate", source: "builtin" }] };
const handler: Handler = (method) => method === "plugins.catalog.browse" ? BROWSE : method === "themes.list" ? THEMES
  : method === "agents.list" ? { agents: [{ id: "main", identity: { name: "Ada" } }, { id: "scout", identity: { name: "Scout" } }] }
  : method === "plugins.catalog.get" ? { version: "1.4.0", changelog: "Faster page splits.", platforms: ["macOS", "Linux"], readme: "Reads PDFs." } : {};
const METHODS = ["plugins.catalog.browse", "plugins.catalog.get", "plugins.install", "themes.list", "agents.list", "skills.search"];

describe("#1049 Seedbank item dialog and seeds", () => {
  it("opens the item dialog from a name, with Version, What changed, Works on and Safety, then Close and Add <name>", async () => {
    const { engine } = engineOf(METHODS, handler);
    const host = await render(engine);
    await click(host.querySelector<HTMLElement>("[data-id='mcp:github'] .sb-name")!);
    const sheet = document.querySelector(".sb-sheet")!;
    expect(sheet.getAttribute("aria-label")).toBe("GitHub");
    expect([...sheet.querySelectorAll("dt")].map(d => d.textContent)).toEqual(["Version", "What changed", "Works on", "Safety"]);
    expect([...sheet.querySelectorAll("dd")].map(d => d.textContent)).toEqual(["1.4.0", "Faster page splits.", "macOS, Linux", "Not checked yet"]);
    expect(sheet.textContent).toContain("By Ada");
    expect(buttons(sheet, "Close")).toHaveLength(1);
    await click(buttons(sheet, "Add GitHub")[0]);
    // Add moves on to the install sheet.
    expect(document.querySelector(".sb-sheet")?.getAttribute("aria-label")).toBe("Add GitHub?");
  });

  it("copies a short seed link, not the seed file, and that link opens again when pasted", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { engine } = engineOf(METHODS, handler);
    const host = await render(engine);
    await click(host.querySelector<HTMLElement>("[data-id='mcp:github'] [aria-label='Copy GitHub’s seed']")!);
    const link = writeText.mock.calls[0]![0];
    expect(link).toBe("branch://seed/mcp/%40ada%2Fgithub");
    expect(link).not.toContain("{");
    expect(parseSeed(link)).toEqual({ ok: true, seed: { kind: "mcp", ref: "@ada/github", name: "@ada/github", by: "" } });
  });

  it("at Technical, a kind with no seed yet shows Copy seed and Download as Coming", async () => {
    at("technical");
    const { engine } = engineOf(METHODS, handler);
    const host = await render(engine, <Seedbank engine={engine} />);
    const theme = host.querySelector("[data-id='looks:grove']") ?? [...host.querySelectorAll("[data-testid=sb-card]")].find(c => c.textContent?.includes("Branch Slate"));
    expect(theme).toBeTruthy();
    const icons = [...theme!.querySelectorAll(".sb-seed [data-coming], .sb-seed [aria-disabled='true']")];
    expect(icons.length).toBeGreaterThanOrEqual(2);
    expect(icons.every(b => b.getAttribute("data-coming") === "Sharing this kind as a seed comes in a later update.")).toBe(true);
    expect(comingControls().some(c => c.where.startsWith("Copy Branch Slate"))).toBe(true);
    expect(undeclaredControls(host)).toEqual([]);
  });

  for (const level of ["regular", "advanced"] as const) {
    it(`at ${level}, a kind with no seed yet has no seed icons and no later-update line`, async () => {
      at(level);
      const { engine } = engineOf(METHODS, handler);
      const host = await render(engine, <Seedbank engine={engine} />);
      const theme = host.querySelector("[data-id='looks:grove']") ?? [...host.querySelectorAll("[data-testid=sb-card]")].find(c => c.textContent?.includes("Branch Slate"));
      expect(theme).toBeTruthy();
      expect(theme!.querySelectorAll(".sb-seed")).toHaveLength(0);
      expect(theme!.querySelectorAll("[data-coming]")).toHaveLength(0);
      // The items that do have a seed keep both icons, live.
      const github = host.querySelector("[data-id='mcp:github']")!;
      expect(github.querySelector("[aria-label='Copy GitHub’s seed']")?.getAttribute("aria-disabled")).toBeNull();
      expect(comingControls().some(c => c.where.startsWith("Copy Branch Slate"))).toBe(false);
    });
  }

  it("at Technical, shows Who gets it for a connector and a plugin as Trunk faces, Coming with one plain reason", async () => {
    at("technical");
    const { engine } = engineOf(METHODS, handler);
    const host = await render(engine);
    for (const id of ["mcp:github", "plugins:brave-search"]) {
      await click(buttons(host.querySelector(`[data-id='${id}']`)!, "Add")[0]);
      const sheet = document.querySelector(".sb-sheet")!;
      const who = [...sheet.querySelectorAll("section")].find(s => s.querySelector("h3")?.textContent === "Who gets it")!;
      expect([...who.querySelectorAll(".sb-who-face")].map(b => b.textContent)).toEqual(["Ada", "Scout"]);
      expect(who.textContent).toContain("Who gets it comes in a later update.");
      expect(who.textContent).not.toContain("Every Trunk.");
      await click(buttons(sheet, "Cancel")[0]);
    }
  });

  for (const level of ["regular", "advanced"] as const) {
    it(`at ${level}, Who gets it for a connector and a plugin says Every Trunk, with no Coming faces or later-update line`, async () => {
      at(level);
      const { engine } = engineOf(METHODS, handler);
      const host = await render(engine);
      for (const id of ["mcp:github", "plugins:brave-search"]) {
        await click(buttons(host.querySelector(`[data-id='${id}']`)!, "Add")[0]);
        const sheet = document.querySelector(".sb-sheet")!;
        const who = [...sheet.querySelectorAll("section")].find(s => s.querySelector("h3")?.textContent === "Who gets it")!;
        expect(who.textContent).toBe("Who gets itEvery Trunk.");
        expect(who.querySelectorAll(".sb-who-face, [data-coming]")).toHaveLength(0);
        expect(sheet.textContent).not.toMatch(LATER);
        await click(buttons(sheet, "Cancel")[0]);
      }
    });
  }

  it("at Technical, an Add the engine can't do yet is Coming with its reason; at Regular and Advanced it isn't drawn", async () => {
    const methods = METHODS.filter(m => m !== "plugins.install");
    for (const level of ["technical", "regular", "advanced"] as const) {
      at(level);
      const { engine } = engineOf(methods, handler);
      const host = await render(engine);
      const row = host.querySelector("[data-id='mcp:github']")!;
      const add = row.querySelector<HTMLElement>("[aria-label='Add GitHub']");
      if (level === "technical") {
        expect(add?.getAttribute("data-coming")).toBe("Adding connectors comes in a later update.");
      } else {
        expect(add).toBeNull();
        expect(row.querySelectorAll("[data-coming]")).toHaveLength(0);
        // The item dialog then offers Close only, with no later-update line.
        await click(row.querySelector<HTMLElement>(".sb-name")!);
        const sheet = document.querySelector(".sb-sheet")!;
        expect(buttons(sheet, "Add GitHub")).toHaveLength(0);
        expect(buttons(sheet, "Close")).toHaveLength(1);
        expect(sheet.textContent).not.toMatch(LATER);
      }
      await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = "";
    }
  });

  it("a seed of a kind Branch can't add gives the later-update reason only at Technical", () => {
    const link = "branch://seed/looks/grove";
    expect(parseSeed(link, true)).toEqual({ ok: false, reason: SEED_KIND_COMING, coming: true });
    expect(parseSeed(link, false)).toEqual({ ok: false, reason: SEED_KIND_UNKNOWN, coming: true });
    expect(SEED_KIND_UNKNOWN).not.toMatch(LATER);
    // With no level given, it follows the saved level.
    at("advanced");
    expect(parseSeed(link)).toMatchObject({ reason: SEED_KIND_UNKNOWN });
    at("technical");
    expect(parseSeed(JSON.stringify({ format: "branch.seed", version: 1, kind: "looks", name: "Grove", by: "", ref: "grove" }))).toMatchObject({ reason: SEED_KIND_COMING });
  });

  it("reads Version and What changed from the gateway's { plugin, detail } answer", async () => {
    const nested: Handler = (method, params) => method === "plugins.catalog.get"
      ? { plugin: { id: "github", name: "GitHub", latestVersion: "2.1.0", official: false, categories: [] },
          detail: { origin: "clawhub", topics: [], configuration: [], mcpServers: [], skills: [], versions: [{ version: "2.1.0", createdAt: 1, changelog: "Reads draft pull requests.", tags: [] }, { version: "2.0.0", createdAt: 0, changelog: "Older.", tags: [] }] } }
      : handler(method, params);
    const { engine } = engineOf(METHODS, nested);
    const host = await render(engine);
    await click(host.querySelector<HTMLElement>("[data-id='mcp:github'] .sb-name")!);
    const sheet = document.querySelector(".sb-sheet")!;
    const facts = Object.fromEntries([...sheet.querySelectorAll("dt")].map(d => [d.textContent, d.nextElementSibling?.textContent]));
    expect(facts["Version"]).toBe("2.1.0");
    expect(facts["What changed"]).toBe("Reads draft pull requests.");
  });
});
