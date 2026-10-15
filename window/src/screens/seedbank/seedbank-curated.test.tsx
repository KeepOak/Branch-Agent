// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { Seedbank } from "./index";
import { pluginEntries } from "./catalog";

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

// #1049 (GOD 20:04Z): R1 Seedbank draws the preview's curated plugins and connectors, not the whole community feed.
const item = (id: string, name: string, category: string, extra: Record<string, unknown> = {}, local: Record<string, unknown> = { present: false, installed: false }) =>
  ({ id, catalog: { name, author: "someone", summary: name + ".", packageName: "@x/" + id, categories: [category], ...extra }, local });
const FEED = { items: [
  item("openclaw", "OpenClaw", "developer-tools", { downloads: 52000 }),
  item("expedia", "Expedia", "travel", { downloads: 52000 }),
  item("shopify-plugin", "Shopify Toolkit", "commerce", { downloads: 52000 }),
  item("brave-search", "Brave web search", "search", { downloads: 4100 }),
  item("github", "GitHub", "integrations", { downloads: 9800 }),
  item("voice-call", "Voice calls", "voice", { official: true }, { present: true, installed: false, pluginId: "voice-call" }),
  item("my-own", "My own thing", "tools", {}, { present: true, installed: true, pluginId: "my-own" }),
] };
const METHODS = ["plugins.catalog.browse", "plugins.install", "skills.search", "themes.list"];

describe("#1049 R1 Seedbank shows the preview's curated catalogue", () => {
  it("leaves third-party feed entries out, and keeps the curated ones with their live data", async () => {
    const { engine } = engineOf(METHODS, method => (method === "plugins.catalog.browse" ? FEED : method === "skills.search" ? { results: [] } : {}));
    const host = await render(engine);
    const text = host.textContent ?? "";
    for (const gone of ["OpenClaw", "Expedia", "Shopify Toolkit"]) expect(text, gone).not.toContain(gone);
    const names = [...host.querySelectorAll(".sb-name")].map(b => b.textContent);
    for (const kept of ["Brave web search", "GitHub", "Voice calls", "My own thing"]) expect(names, kept).toContain(kept);
    // A curated card keeps the feed's install data and its download count.
    expect(host.querySelector("[data-id='mcp:github'] [aria-label='9800 downloads']")).not.toBeNull();
    expect(host.querySelector("[aria-label='52000 downloads']")).toBeNull();
  });

  it("filters only at the R1 boundary: the feed reader itself still returns every item", () => {
    expect(pluginEntries(FEED).map(e => e.name)).toEqual(["OpenClaw", "Expedia", "Shopify Toolkit", "Brave web search", "GitHub", "Voice calls", "My own thing"]);
  });
});
