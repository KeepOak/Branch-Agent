// @vitest-environment jsdom
// Settings › Devices in R1 (#1049 section D): a native R1 page in the R1 Settings frame with the approved preview's
// eleven cards in its order (preview.html PG local), its Learn more sheet, and no Classic section headings: Classic
// Computer & browser's rows are R1 rows on those cards, and its live lists sit inside them without their own heading.
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

const PREVIEW_CARDS = ["Everywhere", "Computers they may use", "Which Trunk uses which", "Who is connected now", "Cloud computers", "Phones and small devices",
  "Let Trunks use this computer", "Runtimes", "Running models here", "More places to run work", "Where scripts run"];
const PREVIEW_REGULAR = ["Everywhere", "Computers they may use", "Which Trunk uses which", "Phones and small devices", "Let Trunks use this computer", "Runtimes"];
const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "node.list", "agents.list", "device.pair.list", "node.pair.list",
  "computer.status", "system.info", "branch.setup.detect", "models.list", "system-presence", "environments.list"];
function engineOf() {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: { gateway: { nodes: { pairing: {} } } } };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Sapling" }] };
    if (method === "node.list") return { nodes: [] };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));
async function mount() {
  const env = engineOf();
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="devices" pages={R1_PAGES} />));
  await settle();
  return env;
}
const sections = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")].map((s) => s.getAttribute("aria-label"));

describe("R1 Settings › Devices is a native R1 page with the preview's cards", () => {
  it("draws the preview's Regular cards under the frame's title, lede and Learn more, with no Classic page or heading", async () => {
    expect(PAGES.devices.cards).toEqual(PREVIEW_CARDS);
    expect(R1_PAGES.devices?.component).toBeUndefined();
    await mount();
    expect(host.querySelector(".r1s-custom, .r1s-classic, [data-classic]")).toBeNull();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Devices");
    expect(host.querySelector(".r1s-lede")?.textContent).toContain(PAGES.devices.lede);
    expect(sections()).toEqual(PREVIEW_REGULAR);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Learn more"));
    expect([...host.querySelectorAll(".r1s-help li")].map((li) => li.textContent)).toEqual(PREVIEW_REGULAR);
  });

  it("draws all eleven preview cards at Technical in order, and no heading but the cards' own", async () => {
    await mount();
    await setLevel("Technical");
    expect(sections()).toEqual(PREVIEW_CARDS);
    expect([...host.querySelectorAll(".r1s-col h2")].map((h) => h.textContent)).toEqual(PREVIEW_CARDS);
  });

  it("says why each Coming row waits in one plain sentence, never naming how Branch works inside", async () => {
    await mount();
    await setLevel("Technical");
    const reasons = [...host.querySelectorAll<HTMLElement>("[data-coming]")].map((r) => (r.querySelector(".r1s-note")?.textContent ?? "").replace(r.querySelector(":scope > b")?.textContent ?? "\u0000", ""));
    expect(reasons.length).toBeGreaterThan(20);
    for (const r of reasons) expect(r, r).not.toMatch(/engine|gateway call|method|config|\b[a-z]+\.[a-z]+\b/i);
  });

  it("saves a Classic row's engine key from its R1 row, with Classic's meaning, and declares every R1 control", async () => {
    const { request } = await mount();
    await setLevel("Technical");
    const row = host.querySelector<HTMLElement>('[data-row="devices.who-is-connected-now.allow-connections-from-this-computer-by-themselves"]');
    const sw = row?.querySelector<HTMLElement>("[role=switch]");
    expect(sw?.getAttribute("aria-checked")).toBe("true");
    await click(sw);
    expect(request.mock.calls.some(([m, p]) => m === "config.patch" && JSON.stringify(p).includes("autoApproveLocal"))).toBe(true);
    const outside = undeclaredControls(host).filter((el) => !el.closest("[data-classic-block]"));
    expect(outside).toEqual([]);
  });
});
