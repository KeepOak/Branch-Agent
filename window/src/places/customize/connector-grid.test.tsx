// @vitest-environment jsdom
// #1101 (Hermes A-141): connectors draw as a grid of apps, each with its logo (or a clean monogram tile) and one plain
// line, and an app listed twice by the catalogue shows once.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { Seedbank } from "../../screens/seedbank";
import { curatedEntries } from "../../screens/seedbank/curated";
import { pluginEntries } from "../../screens/seedbank/catalog";
import { CatalogDialog } from "./catalog";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

function engineOf(methods: string[], answer: (method: string) => unknown) {
  const request = vi.fn(async (method: string) => answer(method));
  return { features: { methods, events: [] }, request, onEvent: () => () => {}, send: async () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
}
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
async function render(engine: WindowEngine, node: ReactNode) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<CapabilityProvider engine={engine}>{node}</CapabilityProvider>));
  await settle();
  return host;
}

const item = (id: string, name: string, summary: string, category = "integrations", local: Record<string, unknown> = { installed: false, present: false, action: "install" }, extra: Record<string, unknown> = {}) =>
  ({ id, catalog: { name, author: "someone", summary, packageName: "@x/" + id, categories: [category], ...extra }, local });

const DIALOG_FEED = { items: [
  item("github", "GitHub", "Repos, issues and pull requests."),
  item("amplitude", "Amplitude", "Charts, dashboards and experiments."),
  item("amplitude-mcp", "Amplitude MCP", "An MCP server for Amplitude analytics. Needs an API key."),
  item("clickup", "ClickUp", "Tasks and docs."),
  item("clickup-catalog", "Clickup", "Tasks, docs and workspaces in ClickUp."),
  item("notion", "Notion", "An MCP server for reading and editing Notion pages. Works with every workspace you can see."),
  item("zorblax", "Zorblax", "Talks to Zorblax."),
] };

describe("#1101 the connector grid (A-141)", () => {
  it("Add a connector shows each app once, with its logo or a monogram tile and one plain line", async () => {
    const engine = engineOf(["plugins.catalog.browse", "plugins.catalog.categories"], m => (m === "plugins.catalog.browse" ? DIALOG_FEED : { categories: [] }));
    await render(engine, <CatalogDialog mode="connector" engine={engine} close={() => {}} done={() => {}} />);
    const cards = [...document.querySelectorAll(".cz-prov")];
    const card = (name: string) => cards.find(c => c.querySelector("b")?.textContent === name)!;
    expect(cards.map(c => c.querySelector("b")?.textContent)).toEqual(["GitHub", "Amplitude", "ClickUp", "Notion", "Zorblax"]);
    expect(card("GitHub").querySelector(".logo")?.getAttribute("data-mark")).toBe("github");
    expect(card("Notion").querySelector(".logo")?.getAttribute("data-mark")).toBe("notion");
    expect(card("Notion").querySelector(".logo svg path")).not.toBeNull();
    expect(card("Zorblax").querySelector(".logo")?.getAttribute("data-mark")).toBe("monogram");
    expect(card("Zorblax").querySelector(".logo")?.textContent).toBe("ZO");
    expect(card("Notion").querySelector(".cz-one")?.textContent).toBe("Reading and editing Notion pages.");
    // Logos are bundled: nothing in the grid loads an image from anywhere.
    expect(document.querySelectorAll(".cz-provs img")).toHaveLength(0);
  });

  it("Seedbank's Connectors keep one card per app, the one on this computer first, with the app's logo", async () => {
    const feed = { items: [
      item("github", "GitHub", "Repos, issues and pull requests.", "integrations", { installed: false, present: false }, { downloads: 9800 }),
      item("github-mcp", "GitHub MCP", "An MCP server for GitHub issues and pull requests. Needs a token.", "integrations", { installed: false, present: true, pluginId: "github-mcp" }),
      item("slack", "Slack", "Channels and messages.", "inbox-collaboration"),
    ] };
    const kept = curatedEntries(pluginEntries(feed)).filter(e => e.kind === "mcp");
    expect(kept.map(e => e.name)).toEqual(["GitHub MCP", "Slack"]);
    expect(kept[0].desc).toBe("GitHub issues and pull requests.");
    const engine = engineOf(["plugins.catalog.browse", "skills.search", "themes.list"], m => (m === "plugins.catalog.browse" ? feed : m === "skills.search" ? { results: [] } : {}));
    const host = await render(engine, <Seedbank engine={engine} />);
    expect(host.querySelectorAll("[data-id^='mcp:github']")).toHaveLength(1);
    expect(host.querySelector("[data-id='mcp:github-mcp'] .logo")?.getAttribute("data-mark")).toBe("github");
    expect(host.querySelector("[data-id='mcp:slack'] .logo")?.getAttribute("data-mark")).toBe("slack");
  });
});
