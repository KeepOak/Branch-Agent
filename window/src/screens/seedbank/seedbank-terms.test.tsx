// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { Seedbank } from "./index";

/* B-070 (Private #1101 c): Seedbank's own words (seed, Grove layout, graft setup, adapter) are explained in plain words on the
   page itself: beside ＋ Paste a seed, on each kind's chip, and in each Coming kind's section. */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const engine = { features: { methods: [], events: [] }, request: vi.fn(async () => ({})), onEvent: () => () => {}, send: async () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
async function render() {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<CapabilityProvider engine={engine}><Seedbank engine={engine} /></CapabilityProvider>));
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return host;
}
const chip = (host: Element, label: string) => [...host.querySelectorAll(".sb-chip")].find(c => c.textContent === label)!;

describe("Seedbank explains its own words (B-070)", () => {
  it("says what a seed is beside Paste a seed, on a pill", async () => {
    const host = await render();
    const hint = host.querySelector(".sb-paste small")!;
    expect(hint.textContent).toBe("A seed is a short link or a .seed file that shares one thing from Seedbank. Paste one here, press ⌘V on this page, or drop a .seed file on the window.");
    expect(hint.classList).toContain("g-label");
  });

  it("explains Grove layouts, graft setups and adapters on their chips and in the Coming sections", async () => {
    const host = await render();
    expect(chip(host, "Grove layouts").getAttribute("title")).toMatch(/^A Grove layout is how your Grove office looks: rooms, desks, decor/);
    expect(chip(host, "Graft setups").getAttribute("title")).toMatch(/^A graft setup is how an outside agent, such as Claude Code, connects to Branch/);
    expect(chip(host, "Adapters").getAttribute("title")).toMatch(/^An adapter changes how one part of Branch behaves/);
    expect(chip(host, "Skills").hasAttribute("title")).toBe(false);
    expect(host.querySelector("[data-coming-kind=groves] .sb-hint")!.textContent).toBe("A Grove layout is how your Grove office looks: rooms, desks, decor, pets placed and the scene. Never your agents or their chats. Grove layouts arrive in Seedbank in a later update.");
    expect(host.querySelector("[data-coming-kind=graftsets] .sb-hint")!.textContent).toBe("A graft setup is how an outside agent, such as Claude Code, connects to Branch: its connect line, with the token left out, and what it may reach. Graft setups arrive in Seedbank in a later update.");
  });

  it("shows nothing raw: no YAML, no method names in the explanations", async () => {
    const host = await render();
    const words = [host.querySelector(".sb-paste small")!.textContent, ...[...host.querySelectorAll(".sb-chip[title]")].map(c => c.getAttribute("title"))].join(" ");
    expect(words).not.toMatch(/yaml|stdio|mcp|\.[a-z]+\.[a-z]+\(/i);
  });
});
