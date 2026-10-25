// @vitest-environment jsdom
// Customize connectors, plugins, skills, catalog, pairing, trunk templates and Get capabilities
// never show a raw engine error at Regular. Advanced keeps the exact words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { CatalogDialog } from "./catalog";
import { GetCapabilitiesDialog } from "./get-capabilities";
import { CustomizePlace } from "./index";
import { PairDialog } from "./pairing";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENGINE = "connect ECONNREFUSED 127.0.0.1:19031";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";
const RAW = /ECONNREFUSED|127\.0\.0\.1|19031|unknown method/;
const CONFIG = {
  hash: "h1",
  sourceConfig: { mcp: { servers: { github: { url: "https://example.test/mcp" } } } },
  runtimeConfig: { mcp: { servers: { github: { url: "https://example.test/mcp" } } } },
};
const BASE: Record<string, unknown> = {
  "agents.list": { defaultId: "main", mainKey: "main", agents: [{ id: "main", name: "Sapling" }] },
  "config.get": CONFIG,
  "tools.effective": { groups: [] },
  "skills.status": { skills: [{ name: "web", skillKey: "web", description: "Search", disabled: false, eligible: true }] },
  "skills.gardener.status": { lastSuccessAtMs: Date.now(), counts: { active: 1, stale: 0, archived: 0 }, skills: [] },
  "skills.proposals.list": { proposals: [] },
  "skills.library.list": { entries: [] },
  "plugins.list": { plugins: [{ id: "pack", name: "Pack", installed: true, enabled: false, state: "disabled", origin: "clawhub", install: { source: "clawhub", packageName: "pack" } }] },
  "plugins.inspect": { ok: true, declared: {}, overview: {} },
  "acpx.agents.list": { agents: [] },
  "tools.catalog": { groups: [] },
  "exec.approvals.get": { hash: "e1", file: { version: 1, agents: {} }, resolvedDefaults: { ask: "on-miss" } },
  "plugins.catalog.categories": { categories: [] },
  "plugins.catalog.browse": { items: [{ id: "linear", catalog: { name: "Linear", summary: "Issues", packageName: "@linear/branch", categories: [] }, local: { installed: false, enabled: false, action: "install" } }] },
};
const GET: Record<string, unknown> = {
  "plugins.list": { plugins: [{ id: "files", name: "Files", description: "Read files", origin: "bundled", installed: true, enabled: true }] },
  "skills.status": { skills: [{ name: "notes", skillKey: "notes", description: "Keep notes", bundled: true, eligible: true }] },
  "plugins.catalog.browse": { items: [{ id: "irc", catalog: { name: "IRC", summary: "Chat over IRC" }, local: { installed: false, action: "install", install: { source: "clawhub", packageName: "irc-plugin" } } }] },
  "skills.search": { results: [] },
  "trunks.template.list": { templates: [{ id: "builder", source: "bundled", name: "Builder", description: "Edits files", skills: 0, routines: 0, connections: [] }] },
};

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => localStorage.clear());
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

const settle = async (n = 8) => { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); };
function engineOf(table: Record<string, unknown>) {
  const request = vi.fn((method: string) => {
    const value = table[method];
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(typeof value === "function" ? (value as () => unknown)() : value ?? { ok: true });
  });
  const engine = { request, onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
  return { engine, request };
}
async function mount(node: React.ReactNode) {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => { root!.render(node); });
  await settle();
}
async function openPlace(kind: string, fx: Record<string, unknown> = {}, level: "regular" | "advanced" = "regular") {
  const { engine } = engineOf({ ...BASE, ...fx });
  await mount(<CustomizePlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} openSettings={() => {}} level={level} />);
  await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "customize", tab: kind } })); });
  await settle();
}
const click = async (el: Element | null | undefined) => {
  expect(el).not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
};
const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const expectPlain = (text: string) => {
  expect(text).not.toMatch(RAW);
  expect(text).toBe(REACH);
};

describe("Customize never shows a raw engine error at Regular", () => {
  it("names a failed connector save in a plain sentence", async () => {
    await openPlace("Connectors", { "config.patch": new Error(ENGINE) });
    await click(host.querySelector('[aria-label="github on or off"]'));
    expectPlain(host.querySelector("[role=alert].cz-error")?.textContent ?? "");
  });

  it("names a failed plugin toggle in a plain sentence", async () => {
    await openPlace("Plugins", { "plugins.setEnabled": new Error(ENGINE) });
    await click(host.querySelector('[aria-label="Pack on or off"]'));
    expectPlain(host.querySelector("[role=alert].cz-error")?.textContent ?? "");
  });

  it("names a plugin's own error in a plain sentence", async () => {
    await openPlace("Plugins", {
      "plugins.list": { plugins: [{ id: "pack", name: "Pack", installed: true, enabled: true, state: "error", origin: "bundled", error: ENGINE }] },
    });
    const card = host.querySelector(".cz-card.warn")?.textContent ?? "";
    expect(card).toContain("Needs a look");
    expect(card).not.toMatch(RAW);
    expect(card).toContain(REACH);
  });

  it("names a failed skill save in a plain sentence", async () => {
    await openPlace("Skills", { "skills.update": new Error(ENGINE) });
    await click(host.querySelector('[data-testid=skill-detail] [aria-label="web on or off"]'));
    expectPlain(host.querySelector("[role=alert].cz-error")?.textContent ?? "");
  });

  it("names the Gardener's last error in a plain sentence", async () => {
    await openPlace("Skills", {
      "skills.gardener.status": { lastSuccessAtMs: Date.now(), lastError: ENGINE, counts: { active: 1, stale: 0, archived: 0 }, skills: [] },
    });
    const line = host.querySelector(".cz-garden .cz-error")?.textContent ?? "";
    expectPlain(line);
  });

  it("names a failed catalog install in a plain sentence", async () => {
    const { engine } = engineOf({
      "plugins.catalog.categories": { categories: [] },
      "plugins.catalog.browse": BASE["plugins.catalog.browse"],
      "plugins.install": new Error(ENGINE),
    });
    await mount(<CatalogDialog mode="plugin" engine={engine} close={() => {}} done={() => {}} />);
    await click(button("Install"));
    expectPlain(host.querySelector("[role=alert].cz-error")?.textContent ?? "");
  });

  it("names a catalogue remote error in a plain sentence", async () => {
    const { engine } = engineOf({
      "plugins.catalog.categories": { categories: [] },
      "plugins.catalog.browse": { items: [], remoteError: ENGINE },
    });
    await mount(<CatalogDialog mode="plugin" engine={engine} close={() => {}} done={() => {}} />);
    expectPlain(host.querySelector(".cz-hint")?.textContent ?? "");
  });

  it("names a failed pairing code in a plain sentence", async () => {
    const { engine } = engineOf({ "device.pair.setupCode": new Error(ENGINE) });
    await mount(<PairDialog engine={engine} close={() => {}} />);
    await click(button("Make the code"));
    expectPlain(host.querySelector("[role=alert].cz-error")?.textContent ?? "");
  });

  it("names a failed trunk template create in a plain sentence", async () => {
    const { engine } = engineOf({ ...GET, "trunks.template.create": new Error(ENGINE) });
    await mount(<GetCapabilitiesDialog engine={engine} close={() => {}} done={() => {}} />);
    await click(button("Trunk templates"));
    await click(button("Create Trunk"));
    expectPlain(host.querySelector("[role=alert].cz-error")?.textContent ?? "");
  });

  it("names a failed Get capabilities install in a plain sentence", async () => {
    const { engine } = engineOf({ ...GET, "plugins.install": new Error(ENGINE) });
    await mount(<GetCapabilitiesDialog engine={engine} close={() => {}} done={() => {}} />);
    await click(button("Plugins"));
    await click(button("Install"));
    expectPlain(document.querySelector("[data-testid=get-result] [role=alert]")?.textContent ?? "");
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    await openPlace("Connectors", { "config.patch": new Error(ENGINE) }, "advanced");
    await click(host.querySelector('[aria-label="github on or off"]'));
    expect(host.querySelector("[role=alert].cz-error")?.textContent).toBe(ENGINE);
  });
});
