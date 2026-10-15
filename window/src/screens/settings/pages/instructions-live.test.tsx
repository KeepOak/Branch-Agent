// @vitest-environment jsdom
// Settings › Instructions & personality in R1 (#1049 section D): a native R1 page with the approved preview's seven cards
// (preview.html PG instructions); the file list sits in Project instructions, and Saved prompts is not on this page.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { undeclaredControls } from "../../../glass/coming-registry";
import { PAGES } from "../nav";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const PREVIEW_CARDS = ["Just about you", "Project instructions", "Kits", "How replies are written", "Prompts behind quick actions", "What goes with every message", "Rules"];
const METHODS = ["config.get", "config.schema", "users.prefs.get", "agents.list", "agents.files.list", "agents.files.get", "agents.files.set", "users.personalFile.get", "users.personalFile.set"];
function engineOf() {
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Sapling" }, { id: "scout", name: "Scout" }] };
    if (method === "agents.files.list") return { workspace: "/w", files: [{ name: "SOUL.md" }] };
    if (method === "agents.files.get") return { file: { name: (params as { name: string }).name, content: "Be kind.\n", hash: "h" } };
    if (method === "users.personalFile.get") return { content: "", hash: null, missing: true };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));
async function mount() {
  const env = engineOf();
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="instructions" pages={R1_PAGES} />));
  await settle();
  return env;
}
const sections = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")];
const card = (t: string) => sections().find((s) => s.getAttribute("aria-label") === t)!;

describe("R1 Settings › Instructions & personality is a native R1 page with the preview's cards", () => {
  it("draws the preview's Regular cards in order under the frame's title, lede and Learn more, with no Classic page", async () => {
    expect(PAGES.instructions.cards).toEqual(PREVIEW_CARDS);
    expect(R1_PAGES.instructions?.component).toBeUndefined();
    await mount();
    expect(host.querySelector(".r1s-custom, .r1s-classic, [data-classic]")).toBeNull();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Instructions & personality");
    expect(host.querySelector(".r1s-lede")?.textContent).toContain(PAGES.instructions.lede);
    // Kits and How replies are written have only rows that wait for a later update at Regular: they show from Advanced.
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(PREVIEW_CARDS.slice(0, 2));
    expect(host.textContent).not.toContain("Saved prompts");
    expect(host.textContent).not.toContain("later update");
  });

  it("keeps the files each Trunk reads, with whose files and the editor, inside Project instructions", async () => {
    const { request } = await mount();
    const proj = card("Project instructions");
    expect(proj.textContent).toContain("Whose files");
    expect(proj.textContent).toContain("Who your assistant is: tone and boundaries");
    expect(proj.textContent).toContain("A file can’t widen what Branch may do; Permissions still decides.");
    expect(request.mock.calls.some(([m]) => m === "agents.files.list")).toBe(true);
    await click([...proj.querySelectorAll("button")].find((b) => b.textContent === "Scout"));
    expect(request.mock.calls.filter(([m]) => m === "agents.files.list").map(([, p]) => p)).toContainEqual({ agentId: "scout" });
  });

  it("draws all seven cards at Advanced, and says why each Coming row waits in plain words", async () => {
    await mount();
    await setLevel("Advanced");
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(PREVIEW_CARDS);
    expect(undeclaredControls(host.querySelector(".r1s-col")!).filter((e) => !e.closest("[data-classic-block]"))).toEqual([]);
    const reasons = [...host.querySelectorAll<HTMLElement>("[data-coming]")].map((r) => (r.querySelector(".r1s-note")?.textContent ?? "").replace(r.querySelector(":scope > b")?.textContent ?? "\u0000", ""));
    expect(reasons.length).toBeGreaterThan(15);
    for (const r of reasons) expect(r, r).not.toMatch(/engine|gateway call|method|config|\b[a-z]+\.[a-z]+\b/i);
  });
});
