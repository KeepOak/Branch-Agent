// @vitest-environment jsdom
// Settings › Permissions in R1 (#1049 section D): a native R1 page with the approved preview's fourteen cards (preview.html
// PG permissions), at the preview's levels. No Classic page: Classic Permissions' sections sit in the cards, with no
// Classic heading.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
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

const REGULAR = ["Mode", "Lockdown", "Without asking", "Privacy"];
const ADVANCED = ["Mode", "Lockdown", "Without asking", "Rules for each tool and folder", "Commands by default", "Checks before anything runs", "Approvals", "Guards", "Money", "What each connector may do", "Isolation and sandbox", "Privacy"];
const TECHNICAL = ["Mode", "Lockdown", "Without asking", "Rules for each tool and folder", "Commands by default", "Checks before anything runs", "Approvals", "Guards", "Money", "What each connector may do", "Isolation and sandbox", "Network and sandbox", "Company policy", "Privacy"];
const METHODS = ["config.get", "config.patch", "config.schema", "users.prefs.get", "agents.list", "node.list", "exec.approvals.get", "exec.approvals.set"];
function engineOf() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "agents.list") return { agents: [{ id: "main", name: "Sapling" }] };
    if (method === "node.list") return { nodes: [] };
    if (method === "exec.approvals.get") return { hash: "a1", file: { version: 1, defaults: {}, agents: {} } };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
}
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const setLevel = async (label: string) => {
  const b = [...host.querySelectorAll<HTMLButtonElement>(".r1s-level button")].find((x) => x.textContent === label);
  expect(b).toBeTruthy(); await act(async () => b!.click()); await settle();
};
const cards = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")].map((s) => s.getAttribute("aria-label"));
const card = (t: string) => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")].find((s) => s.getAttribute("aria-label") === t)!;

describe("R1 Settings › Permissions is a native R1 page with the preview's cards", () => {
  it("draws the preview's cards in order at each level, with Classic's sections inside and no Classic page", async () => {
    expect(PAGES.permissions.cards).toEqual(TECHNICAL);
    expect(R1_PAGES.permissions?.component).toBeUndefined();
    await act(async () => root.render(<SettingsFrame engine={engineOf()} page="permissions" pages={R1_PAGES} />));
    await settle();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Permissions");
    await setLevel("Regular");
    expect(cards()).toEqual(REGULAR);
    expect(card("Without asking").textContent).toContain("Read files in Documents and Downloads");
    await setLevel("Advanced");
    expect(cards()).toEqual(ADVANCED);
    await setLevel("Technical");
    expect(cards()).toEqual(TECHNICAL);
    expect(host.querySelector('[data-classic="permissions"], .r1s-custom')).toBeNull();
    expect(card("Mode").textContent).toContain("Mode everywhere");
    expect(card("Privacy").textContent).toContain("Site icons and link previews");
    // No Classic headings inside the cards, and no link out that the preview doesn't draw.
    expect([...host.querySelectorAll(".r1s-col h1, .r1s-col h2")].map((h) => h.textContent)).toEqual(TECHNICAL);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Open that switch")).toBe(false);
  });
});
