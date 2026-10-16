// @vitest-environment jsdom
// Settings › Privacy draws the town lookup on the re-hosted page: the list, its credit and its refresh read and write
// the same settings, and adding a town to messages stays grey until a later update.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set"];
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
async function mount(level: "regular" | "advanced", config?: Record<string, unknown>) {
  localStorage.setItem("branch.level", level);
  const env = engineOf(config);
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="privacy" pages={R1_PAGES} />));
  await settle();
  return env;
}
const row = (id: string) => host.querySelector<HTMLElement>(`[data-row="${id}"]`);
const field = (id: string) => row(id)?.querySelector("input");
async function typeIn(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  await settle();
}

it("shows the usual town list on Privacy and saves a change", async () => {
  const { request } = await mount("regular");
  expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Privacy & data");
  expect(host.querySelector(".r1s-classic[data-classic='usage']")).not.toBeNull();
  expect(field("privacy.town-lookup.where-the-town-lookup-list-comes-from")?.value).toBe("https://download.db-ip.com/free/dbip-city-lite-{yyyy}-{mm}.mmdb.gz");
  expect(field("privacy.town-lookup.the-credit-line-for-the-town-list")?.value).toBe("IP Geolocation by DB-IP");
  expect(field("privacy.town-lookup.the-page-for-that-credit")?.value).toBe("https://db-ip.com");
  expect(field("privacy.town-lookup.how-often-to-refresh-the-town-list")?.value).toBe("30");
  expect(row("privacy.town-lookup.add-my-location-to-messages")).toBeNull();
  await typeIn(field("privacy.town-lookup.how-often-to-refresh-the-town-list")!, "14");
  expect(field("privacy.town-lookup.how-often-to-refresh-the-town-list")?.value).toBe("14");
  const refresh = request.mock.calls.find(([method, params]) => method === "config.patch" && String((params as { raw?: string }).raw).includes("refreshDays"));
  expect(JSON.parse((refresh![1] as { raw: string }).raw)).toEqual({ plugins: { entries: { geolocation: { config: { refreshDays: 14 } } } } });
  await typeIn(field("privacy.town-lookup.the-page-for-that-credit")!, "https://example.com/credit");
  expect(field("privacy.town-lookup.the-page-for-that-credit")?.value).toBe("https://example.com/credit");
  const link = request.mock.calls.find(([method, params]) => method === "config.patch" && String((params as { raw?: string }).raw).includes("attributionUrl"));
  expect(JSON.parse((link![1] as { raw: string }).raw)).toEqual({ plugins: { entries: { geolocation: { config: { attributionUrl: "https://example.com/credit" } } } } });
});

it("shows a saved town list, and greys adding a location to messages", async () => {
  await mount("advanced", { plugins: { entries: { geolocation: { config: { databaseUrl: "https://example.com/cities.mmdb.gz", attributionText: "Town list by Example", attributionUrl: "https://example.com/credit", refreshDays: 7 } } } } });
  expect(field("privacy.town-lookup.where-the-town-lookup-list-comes-from")?.value).toBe("https://example.com/cities.mmdb.gz");
  expect(field("privacy.town-lookup.the-credit-line-for-the-town-list")?.value).toBe("Town list by Example");
  expect(field("privacy.town-lookup.the-page-for-that-credit")?.value).toBe("https://example.com/credit");
  expect(field("privacy.town-lookup.how-often-to-refresh-the-town-list")?.value).toBe("7");
  const location = row("privacy.town-lookup.add-my-location-to-messages");
  expect(location?.querySelector(".r1s-note")?.textContent).toBe("Add my location to messages comes in a later update.");
  expect(location?.querySelector("button")?.hasAttribute("disabled")).toBe(true);
  expect(host.querySelector('[data-row="general.writing.location"]')).toBeNull();
});
