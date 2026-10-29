// @vitest-environment jsdom
// Settings › Instructions & personality: each file's Read switch, and Write on a file Branch can't open here, were greyed
// with no reason (Private #1093 point 2). Each greyed control names a visible line with aria-describedby that says why.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
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

const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
/** The visible line a greyed control (or the wrapper it sits in, up to its row) names with aria-describedby. */
function reasonOf(el: Element, row: Element): string {
  for (let n: Element | null = el; n && n !== row.parentElement; n = n.parentElement) {
    const id = n.getAttribute("aria-describedby");
    if (!id) continue;
    const why = document.getElementById(id);
    expect(why, `aria-describedby target of ${el.outerHTML.slice(0, 80)}`).toBeTruthy();
    expect(row.contains(why), "the reason shows in the control's own row").toBe(true);
    expect(why!.hidden).toBe(false);
    return why!.textContent?.trim() ?? "";
  }
  return "";
}

const METHODS = ["config.get", "config.schema", "users.prefs.get", "agents.list", "agents.files.list", "agents.files.get", "agents.files.set", "users.personalFile.get", "users.personalFile.set"];
function engineOf() {
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Sapling" }] };
    if (method === "agents.files.list") return { workspace: "/w", files: [{ name: "SOUL.md" }] };
    if (method === "agents.files.get") return (params as { name: string }).name === "USER.md"
      ? { file: { name: "USER.md", content: "", hash: null, missing: true } }
      : { file: { name: (params as { name: string }).name, content: "Be kind.\n", hash: "h" } };
    if (method === "users.personalFile.get") return { content: "", hash: null, missing: true };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] }, sharedGateway: false } as unknown as WindowEngine;
}
async function mount() {
  await act(async () => root.render(<SettingsFrame engine={engineOf()} page="instructions" pages={R1_PAGES} />));
  await settle();
}
const filesRow = () => host.querySelector<HTMLElement>('[data-row="instructions.project.files"]')!;

describe("Settings › Instructions & personality: greyed controls say why", () => {
  it("every file's greyed Read switch names one visible line saying Branch decides what it reads", async () => {
    await mount();
    const row = filesRow();
    expect(row).toBeTruthy();
    const reads = [...row.querySelectorAll<HTMLInputElement>('input[aria-label^="Read "]')];
    expect(reads.map((r) => r.getAttribute("aria-label"))).toEqual(["Read SOUL.md", "Read IDENTITY.md", "Read USER.md", "Read AGENTS.md", "Read TOOLS.md", "Read SOP.md", "Read MEMORY.md", "Read HEARTBEAT.md"]);
    for (const sw of reads) {
      expect(sw.disabled, sw.getAttribute("aria-label")!).toBe(true);
      expect(reasonOf(sw, row), sw.getAttribute("aria-label")!).toMatch(/^Branch turns Read on by itself: it reads each file that has something in it/);
    }
    expect(row.textContent).toContain("Branch turns Read on by itself");
  });

  it("a greyed Write or Edit names its row's own line: the file Branch can't open here yet", async () => {
    await mount();
    const row = filesRow();
    const greyed = [...row.querySelectorAll<HTMLButtonElement>(".if-row > button")].filter((b) => b.disabled);
    expect(greyed.length).toBe(3);
    const said = greyed.map((b) => reasonOf(b, row));
    expect(said).toEqual(["Branch can’t open TOOLS.md here yet.", "Branch can’t open SOP.md here yet.", "Branch can’t open HEARTBEAT.md here yet."]);
    const live = [...row.querySelectorAll<HTMLButtonElement>(".if-row > button")].filter((b) => !b.disabled);
    expect(live.length).toBeGreaterThan(0);
    for (const b of live) expect(b.hasAttribute("aria-describedby")).toBe(false);
  });
});
