// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import { Seedbank } from "./index";
import { parseSeed } from "./seed";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

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

  it("shows Copy seed and Download on every card; a kind with no seed yet has them as Coming", async () => {
    const { engine } = engineOf(METHODS, handler);
    const host = await render(engine, <Seedbank engine={engine} />);
    const theme = host.querySelector("[data-id='looks:grove']") ?? [...host.querySelectorAll("[data-testid=sb-card]")].find(c => c.textContent?.includes("Branch Slate"));
    expect(theme).toBeTruthy();
    const icons = [...theme!.querySelectorAll(".sb-seed [data-coming], .sb-seed [aria-disabled='true']")];
    expect(icons.length).toBeGreaterThanOrEqual(2);
    expect(comingControls().some(c => c.where.startsWith("Copy Branch Slate"))).toBe(true);
    expect(undeclaredControls(host)).toEqual([]);
  });

  it("shows Who gets it for a connector and a plugin as Trunk faces, Coming with one plain reason", async () => {
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
});
