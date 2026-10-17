// @vitest-environment jsdom
// Settings › Developer in R1 (#1049 section D): a native R1 page in the R1 Settings frame with the approved preview's
// twenty-one cards in its order (preview.html PG developer), its Learn more sheet, and no Classic section headings.
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

const PREVIEW_CARDS = ["Build on Branch", "Local address", "branch:// links", "Editors and other apps", "Let other assistants use Branch", "Runs and traces",
  "Run without the window", "From a terminal", "Settings file", "System", "Troubleshooting", "Help with code", "Widgets", "Memory and automations, for scripts", "Tools",
  "Logs", "Docker", "Hooks", "Network", "Health", "Everything else"];
const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "system.info", "plugins.list", "audit.list"];
function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) out[key] = merge((out[key] ?? {}) as Record<string, unknown>, value as Record<string, unknown>);
    else out[key] = value;
  }
  return out;
}
function engineOf(config: Record<string, unknown> = {}) {
  let snap = { hash: "h1", valid: true, config };
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "config.get") return structuredClone(snap);
    if (method === "config.patch") {
      snap = { hash: `${snap.hash}x`, valid: true, config: merge(snap.config, JSON.parse((params as { raw: string }).raw) as Record<string, unknown>) };
      return { ok: true, hash: snap.hash, config: structuredClone(snap.config) };
    }
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
async function mount(config?: Record<string, unknown>) {
  localStorage.setItem("branch.level", "technical");
  const env = engineOf(config);
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="developer" pages={R1_PAGES} />));
  await settle();
  return env;
}
const row = (id: string) => host.querySelector<HTMLElement>(`[data-row="${id}"]`);
const sections = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")].map((s) => s.getAttribute("aria-label"));

describe("R1 Settings › Developer is a native R1 page with the preview's cards", () => {
  it("draws the preview's twenty-one cards in order under the frame's title, lede and Learn more, with no Classic page", async () => {
    expect(PAGES.developer.cards).toEqual(PREVIEW_CARDS);
    expect(R1_PAGES.developer?.component).toBeUndefined();
    await mount();
    expect(host.querySelector(".r1s-custom, .r1s-classic, [data-classic]")).toBeNull();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Developer");
    expect(host.querySelector(".r1s-lede")?.textContent).toContain(PAGES.developer.lede);
    expect(sections()).toEqual(PREVIEW_CARDS);
    expect([...host.querySelectorAll(".r1s-col h2")].map((h) => h.textContent)).toEqual(PREVIEW_CARDS);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Learn more"));
    expect([...host.querySelectorAll(".r1s-help li")].map((li) => li.textContent)).toEqual(PREVIEW_CARDS);
  });

  it("says why each Coming row waits in one plain sentence, never naming how Branch works inside", async () => {
    await mount();
    const reasons = [...host.querySelectorAll<HTMLElement>("[data-coming]")].map((r) => (r.querySelector(".r1s-note")?.textContent ?? "").replace(r.querySelector(":scope > b")?.textContent ?? "\u0000", ""));
    expect(reasons.length).toBeGreaterThan(15);
    for (const r of reasons) expect(r, r).not.toMatch(/engine|gateway call|method|config|\b[a-z]+\.[a-z]+\b/i);
  });

  it("declares every R1 control outside Classic's own blocks", async () => {
    await mount();
    expect(undeclaredControls(host).filter((el) => !el.closest("[data-classic-block]"))).toEqual([]);
  });

  it("greys the workspace path command until a later update", async () => {
    await mount();
    const path = row("developer.everything-else.workspace-path-command");
    expect(path?.querySelector(".r1s-note")?.textContent).toBe("Workspace path command comes in a later update.");
    expect(path?.querySelector<HTMLButtonElement>("[role=switch]")?.disabled).toBe(true);
    expect(host.textContent).not.toContain("Where the town lookup list comes from");
  });

  it("keeps the workspace path command grey when that command is switched on", async () => {
    await mount({ plugins: { entries: { "oc-path": { enabled: true } } } });
    expect(row("developer.everything-else.workspace-path-command")?.querySelector(".r1s-note")?.textContent).toBe("Workspace path command comes in a later update.");
    expect(row("developer.everything-else.workspace-path-command")?.querySelector<HTMLButtonElement>("[role=switch]")?.disabled).toBe(true);
  });
});

// Developer: "See them" and "See examples" scroll to their R1 sections. The selectors used to name Classic's data-sec
// markers only, so the R1 page had nothing to scroll to and the buttons read as dead.
describe("Developer: the See them and See examples jumps", () => {
  afterEach(() => { delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; });
  const jumpButton = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
  it.each([["See them", "Build on Branch"], ["See examples", "From a terminal"]])("%s scrolls to the %s section", async (button, section) => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) { scrolled.push(this); };
    await mount();
    await click(jumpButton(button));
    expect(scrolled.map((el) => el.getAttribute("aria-label"))).toContain(section);
  });
});
