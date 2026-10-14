// @vitest-environment jsdom
// Settings › Sign-ins & keys in R1 (#1049 section D): a native R1 page with the approved preview's four cards
// (preview.html PG signins); "Keys, technical" folds into Keys Branch holds.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { undeclaredControls } from "../../../glass/coming-registry";
import { PAGES } from "../nav";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";
import { ADMIN_ONLY } from "./classic-host";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const PREVIEW_CARDS = ["Branch may fill", "Where passwords come from", "Keys Branch holds", "Narrow keys"];
const METHODS = ["config.get", "config.patch", "config.schema", "users.prefs.get", "secrets.store.list", "secrets.store.set", "secrets.reload"];
function engineOf(scopes = ["operator.admin"]) {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "secrets.store.list") return { entries: [{ name: "OPENAI_API_KEY", kind: "secret", updatedAtMs: Date.now(), allowedHosts: ["api.example.com"] }] };
    if (method === "secrets.reload") return { warningCount: 0 };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes, features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));
async function mount(scopes?: string[]) {
  const env = engineOf(scopes);
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="signins" pages={R1_PAGES} />));
  await settle();
  return env;
}
const sections = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")];

describe("R1 Settings › Sign-ins & keys is a native R1 page with the preview's cards", () => {
  it("draws the preview's Regular cards under the frame's title, lede and Learn more, with no Classic page", async () => {
    expect(PAGES.signins.cards).toEqual(PREVIEW_CARDS);
    expect(R1_PAGES.signins?.component).toBeUndefined();
    await mount();
    expect(host.querySelector(".r1s-custom, .r1s-classic, [data-classic]")).toBeNull();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Sign-ins & keys");
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(["Branch may fill", "Narrow keys"]);
  });

  it("draws all four cards at Technical, with the keys and the technical rows inside Keys Branch holds and no Classic heading", async () => {
    const { request } = await mount();
    await setLevel("Technical");
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(PREVIEW_CARDS);
    const keys = sections()[2];
    expect(keys.textContent).toContain("OPENAI_API_KEY");
    expect(keys.textContent).toContain("Reload keys");
    expect(host.textContent).not.toContain("Keys, technical");
    await click([...keys.querySelectorAll("button")].find((b) => b.textContent === "Reload"));
    expect(request.mock.calls.some(([m]) => m === "secrets.reload")).toBe(true);
    const reasons = [...host.querySelectorAll<HTMLElement>("[data-coming]")].map((r) => (r.querySelector(".r1s-note")?.textContent ?? "").replace(r.querySelector(":scope > b")?.textContent ?? "\u0000", ""));
    for (const r of reasons) expect(r, r).not.toMatch(/engine|gateway call|method|config|\b[a-z]+\.[a-z]+\b/i);
  });

  it("keeps the keys away from a connection that may not change setup, and says why", async () => {
    const { request } = await mount(["operator.read"]);
    await setLevel("Technical");
    expect(sections()[2].textContent).toContain(ADMIN_ONLY);
    expect(request.mock.calls.some(([m]) => m === "secrets.store.list")).toBe(false);
  });
});
