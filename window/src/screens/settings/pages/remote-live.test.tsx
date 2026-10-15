// @vitest-environment jsdom
// Settings › Remote access in R1 (#1049 section D): a native R1 page in the R1 Settings frame, with the approved
// preview's cards in its order (preview.html PG remote), its rows and its Learn more sheet, not Classic Gateway in a
// wrapper and without Classic's chat-app sections. Every working Classic control lands live on its row.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { undeclaredControls } from "../../../glass/coming-registry";
import { PAGES, pageFor } from "../nav";
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

const PREVIEW_CARDS = ["Keep Branch running", "Reach", "How it’s reached", "What it has been doing", "Another computer", "Connection", "Exposure", "Limits", "App previews", "From scripts", "Never break"];
/** The preview's rows at each level, card by card; Classic's working rows the preview doesn't name are in EXTRA. */
const PREVIEW: Record<string, string[]> = {
  "Keep Branch running": ["Gateway", "Carry on interrupted work by itself", "Show the gateway in the tray", "Ask before quitting while work runs"],
  Reach: ["Who can reach the Gateway", "Port", "Sign-in", "Through Cloudflare", "Tailscale", "Tailscale access", "Serve Branch’s page to browsers"],
  "How it’s reached": ["Label this computer", "Branch in your browser", "Web address path"],
  "What it has been doing": ["A terminal where the Gateway runs"],
  "Another computer": ["How to reach it", "Check the SSH host key", "Sign in through a proxy"],
  Connection: ["Gateway address", "Session key or password", "Apply settings changes", "Only join a running Gateway", "Infrastructure settings"],
  Exposure: ["Accept files and pictures", "HSTS header", "HTTPS for the Gateway", "Allowed browser addresses", "Trust the Host header for origins"],
  Limits: ["Wrong sign-ins allowed", "per", "Then lock that address for", "Never lock out this computer"],
  "App previews": ["Reach previews from other devices"],
  "From scripts": ["Send a message", "Connect a chat app", "Ask a poll", "Everything else in a chat"],
  "Never break": ["Canary, journal and rollback"],
};
const EXTRA: Record<string, string[]> = {
  "Keep Branch running": ["Keep working when the window closes"],
  Reach: ["The address"],
  "What it has been doing": ["Restart the engine"],
  "Another computer": ["Its address", "SSH address", "Its gateway key", "Certificate fingerprint", "Connect"],
  Connection: ["Gateway ping", "Gateway activity"],
  Exposure: ["Risky switches"],
  "From scripts": ["Send to several chats"],
};
const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "health", "system.info", "presence.query", "gateway.restart.request"];
function engineOf() {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: { gateway: { bind: "lan", controlUi: { allowedOrigins: ["https://a.example.com"] } } } };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "health") return { ok: true, ts: Date.now() - 60_000, durationMs: 4, channels: { telegram: { connected: true } }, channelLabels: { telegram: "Telegram" } };
    if (method === "system.info") return { uptimeMs: 3_600_000, pid: 7 };
    if (method === "presence.query") return { totalDevices: 3 };
    if (method === "gateway.restart.request") return { status: "deferred" };
    return { ok: true };
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const button = (scope: ParentNode | null, text: string) => [...(scope ?? document).querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
const row = (id: string) => host.querySelector<HTMLElement>(`[data-row="${id}"]`);
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));
async function mount(page = "remote") {
  const env = engineOf();
  await act(async () => root.render(<SettingsFrame engine={env.engine} page={page} pages={R1_PAGES} />));
  await settle();
  return env;
}
const sections = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")];
const labels = (sec: HTMLElement) => [...sec.querySelectorAll<HTMLElement>(".r1s-row > b")].map((b) => b.textContent ?? "");
const card = (title: string) => sections().find((s) => s.getAttribute("aria-label") === title)!;

describe("R1 Settings › Remote access is a native R1 page with the preview's cards", () => {
  it("draws the preview's Regular cards under the frame's title, lede and Learn more", async () => {
    expect(PAGES.remote.cards).toEqual(PREVIEW_CARDS);
    expect(R1_PAGES.remote?.component).toBeUndefined();
    await mount();
    expect(host.querySelector(".r1s-custom, .r1s-classic, [data-classic]")).toBeNull();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Remote access");
    expect(host.querySelector(".r1s-lede")?.textContent).toContain(PAGES.remote.lede);
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(["Keep Branch running", "What it has been doing"]);
    // The preview's own rows on this card wait for a later update: Regular shows only what works, Advanced shows them too.
    expect(labels(card("Keep Branch running")).filter((l) => !EXTRA["Keep Branch running"].includes(l))).toEqual([]);
    await click(button(host, "Learn more"));
    expect([...host.querySelectorAll(".r1s-help li")].map((li) => li.textContent)).toEqual(["Keep Branch running", "What it has been doing"]);
    await setLevel("Advanced");
    expect(labels(card("Keep Branch running")).filter((l) => !EXTRA["Keep Branch running"].includes(l))).toEqual(PREVIEW["Keep Branch running"]);
  });

  it("draws all eleven preview cards at Technical, in order, each with the preview's rows, and no chat-app sections", async () => {
    await mount();
    await setLevel("Technical");
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(PREVIEW_CARDS);
    for (const [title, rows] of Object.entries(PREVIEW)) {
      expect(labels(card(title)).filter((l) => !(EXTRA[title] ?? []).includes(l)), title).toEqual(rows);
      expect(labels(card(title)).filter((l) => (EXTRA[title] ?? []).includes(l)), title).toEqual(EXTRA[title] ?? []);
    }
    expect(host.textContent).not.toMatch(/Chat apps, (more|even more|in depth)/);
  });

  it("says why each Coming row waits in one plain sentence, never naming how Branch works inside", async () => {
    await mount();
    await setLevel("Technical");
    // The row's own label is the preview's words, so only the rest of the sentence is checked.
    const reasons = [...host.querySelectorAll<HTMLElement>("[data-coming]")].map((r) => (r.querySelector(".r1s-note")?.textContent ?? "").replace(r.querySelector(":scope > b")?.textContent ?? "\u0000", ""));
    expect(reasons.length).toBeGreaterThan(8);
    for (const r of reasons) expect(r, r).not.toMatch(/engine|gateway call|method|config|\b[a-z]+\.[a-z]+\b/i);
  });

  it("keeps every working Classic control live, declared, and on Classic's engine calls", async () => {
    const { request } = await mount();
    await setLevel("Technical");
    for (const id of Object.keys(R1_PAGES.remote?.controls ?? {})) expect(row(id), id).not.toBeNull();
    expect(undeclaredControls(host)).toEqual([]);
    expect(row("remote.doing.lately")?.textContent).toContain("Telegram keeps working when the window is closed.");
    expect(row("remote.doing.lately")?.textContent).toContain("3 apps connected");
    await click(button(row("remote.doing.restart"), "Restart the engine"));
    expect(request.mock.calls.some(([m]) => m === "gateway.restart.request")).toBe(true);
    expect(row("remote.reach.bind")?.querySelector('[aria-checked="true"]')?.textContent).toBe("My network");
    expect(row("remote.exposure.origins")?.textContent).toContain("https://a.example.com");
    await click(button(row("remote.exposure.origins"), "Remove"));
    expect(request.mock.calls.filter(([m]) => m === "config.patch").length).toBeGreaterThan(0);
  });

  it("opens old Gateway links on Remote access", async () => {
    expect(pageFor("gateway")).toBe("remote");
  });
});
