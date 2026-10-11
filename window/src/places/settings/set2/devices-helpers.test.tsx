// @vitest-environment jsdom
// Settings › Devices & apps and Settings › Helpers: what were Customize's Everywhere and Specialists tabs (DA-55).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import type { Level } from "../../../places-nav/settings-nav";
import { visibleDevNotes } from "../../../shell/shown-why.testing";
import { SettingsPage } from "../index";

vi.mock("../../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));

const BASE: Record<string, unknown> = {
  "agents.list": { defaultId: "main", mainKey: "main", agents: [{ id: "main", name: "Sapling" }, { id: "oak", name: "Oak" }] },
  "node.list": { nodes: [{ nodeId: "n1", displayName: "Desk", platform: "win32", connected: true }] },
  "device.pair.list": { pending: [], paired: [{ deviceId: "d1", displayName: "Phone", platform: "ios", deviceFamily: "iPhone" }] },
  "channels.status": { channelOrder: ["telegram", "discord"], channelLabels: { telegram: "Telegram", discord: "Discord" }, channelAccounts: { telegram: [{ accountId: "default", configured: true, running: false, connected: false }], discord: [{ accountId: "default", configured: true, running: true, connected: true }] } },
};

let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

async function open(page: "devices" | "helpers", fx: Record<string, unknown> = {}, level: Level = "regular") {
  const table = { ...BASE, ...fx };
  const request = vi.fn(async (method: string, _params?: unknown) => table[method] ?? { ok: true });
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] };
  const openSettings = vi.fn();
  await act(async () => root.render(<SettingsPage page={page} title={page === "devices" ? "Devices & apps" : "Helpers"} level={level} engine={engine} openSettings={openSettings} />));
  await flush();
  return { request, openSettings };
}
const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); };

describe("Settings › Helpers", () => {
  it("never shows helper conversations as helpers, and greys what the engine lacks", async () => {
    const { request } = await open("helpers", { "sessions.list": { sessions: [{ key: "agent:main:subagent:1", label: "Helper run" }] } });
    expect(request).not.toHaveBeenCalledWith("sessions.list", expect.anything());
    expect(host.querySelector("h1")?.textContent).toBe("Helpers");
    expect(host.textContent).toContain("Helpers a Trunk calls in for one job, then lets go.");
    expect(host.textContent).toContain("No specialists yet.");
    expect(host.querySelector('[data-testid="fleet"]')?.textContent).toBe("2 Trunks on 1 computer");
    const patterns = [...host.querySelectorAll('[aria-label="How Trunks work together"] [role="radio"]')] as HTMLButtonElement[];
    expect(patterns).toHaveLength(6);
    expect(patterns.every(p => p.disabled && p.title === "")).toBe(true);
    expect(button("Start")!.disabled).toBe(true);
    expect(visibleDevNotes(host)).toEqual([]);
  });
  it("shows Built in and Other coding agents only from Advanced, and See how opens Connected agents", async () => {
    await open("helpers");
    expect(host.textContent).not.toContain("Built in");
    await act(async () => root.unmount()); root = createRoot(host);
    const { openSettings } = await open("helpers", {}, "advanced");
    expect(host.textContent).toContain("Built in");
    await click(button("See how"));
    expect(openSettings).toHaveBeenCalledWith("agents");
  });
});

describe("Settings › Devices & apps", () => {
  it("shows the surface tiles from the engine's computers and devices", async () => {
    const { request } = await open("devices");
    expect(request).not.toHaveBeenCalledWith("models.list", expect.anything());
    expect(host.querySelector("h1")?.textContent).toBe("Devices & apps");
    expect([...host.querySelectorAll("[data-surface]")].map(t => t.getAttribute("data-surface"))).toEqual(["Windows", "Mac", "Terminal", "iPhone", "Android", "keepoak.com", "Chat apps", "A page of your own"]);
    const tile = (name: string) => host.querySelector(`[data-surface="${name}"]`)!;
    expect(tile("Windows").textContent).toContain("Desk");
    expect(tile("Windows").textContent).toContain("Connected");
    expect(tile("iPhone").textContent).toContain("Connected");
    expect(tile("Android").textContent).toContain("Not set up");
    expect(tile("Chat apps").textContent).toContain("Discord is connected");
    expect(button("Connect", tile("keepoak.com"))!.disabled).toBe(true);
    expect(button("Get the snippet")!.disabled).toBe(true);
  });
  it("pairs from a phone tile and opens Settings › Chat apps", async () => {
    const { request, openSettings } = await open("devices", { "device.pair.setupCode": { setupId: "s1", setupCode: "WXYZ-1234", gatewayUrl: "ws://x", auth: "token", urlSource: "lan" } });
    await click(button("Pair", host.querySelector('[data-surface="Android"]')!));
    await click(document.querySelectorAll('input[name="pair-access"]')[1]);
    await click(button("Make the code", document.body));
    expect(request).toHaveBeenCalledWith("device.pair.setupCode", { includeQr: true, bootstrapProfile: "limited" });
    await click(button("Done", document.body));
    await click(button("Chat apps", host.querySelector('[data-surface="Chat apps"]')!));
    expect(openSettings).toHaveBeenCalledWith("chatapps");
  });
});
