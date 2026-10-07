// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { CustomizePlace } from "./index";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE: Record<string, unknown> = {
  "agents.list": { defaultId: "main", mainKey: "main", agents: [{ id: "main", name: "Sapling" }, { id: "oak", name: "Oak" }] },
  "node.list": { nodes: [{ nodeId: "n1", displayName: "Desk", platform: "win32", connected: true }] },
  "device.pair.list": { pending: [], paired: [{ deviceId: "d1", displayName: "Phone", platform: "ios", deviceFamily: "iPhone" }] },
  "channels.status": { channelOrder: ["telegram", "discord"], channelLabels: { telegram: "Telegram", discord: "Discord" }, channelAccounts: { telegram: [{ accountId: "default", configured: true, running: false, connected: false }], discord: [{ accountId: "default", configured: true, running: true, connected: true }] } },
  "plugins.list": { plugins: [{ id: "slack", name: "Slack", installed: true, enabled: false, state: "disabled", channelIds: ["slack"] }, { id: "irc", name: "IRC", installed: true, enabled: false, channelIds: ["irc"] }] },
};

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });

async function open(tab: string, fx: Record<string, unknown> = {}, level: Level = "regular", running = 0) {
  const table = { ...BASE, ...fx };
  const request = vi.fn((method: string) => {
    const v = table[method];
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? { ok: true });
  });
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] };
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<CustomizePlace engine={engine} facts={{ running, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} level={level} />); });
  await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "customize", tab } })); });
  await act(async () => { await Promise.resolve(); });
  return request;
}
const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await Promise.resolve(); }); };

describe("Customize › Specialists", () => {
  it("never shows helper conversations as specialists, and greys what the engine lacks", async () => {
    const request = await open("Specialists", { "sessions.list": { sessions: [{ key: "agent:main:subagent:1", label: "Helper run" }] } }, "regular", 2);
    expect(request).not.toHaveBeenCalledWith("sessions.list", expect.anything());
    expect(host.textContent).toContain("Helpers a Trunk calls in for one job, then lets go.");
    expect(host.textContent).toContain("No specialists yet.");
    expect(host.querySelector('[data-testid="fleet"]')?.textContent).toBe("2 Trunks on 1 computer2 working now");
    const patterns = [...host.querySelectorAll('[aria-label="How Trunks work together"] [role="radio"]')] as HTMLButtonElement[];
    expect(patterns).toHaveLength(6);
    expect(patterns.every(p => p.disabled && p.title === "")).toBe(true);
    expect(button("Start")!.disabled).toBe(true); expect(button("Start")!.title).toBe("");
    expect(visibleDevNotes(host)).toEqual([]);
  });
  it("shows Built in and Other coding agents only from Advanced", async () => {
    await open("Specialists");
    expect(host.textContent).not.toContain("Built in");
    if (root) await act(async () => root!.unmount()); document.body.innerHTML = "";
    await open("Specialists", {}, "advanced");
    expect(host.textContent).toContain("Built in");
    await click(button("See how"));
    expect(host.querySelector('[data-kind][aria-current="true"]')?.getAttribute("data-kind")).toBe("Agents");
  });
});

describe("Customize › Chat apps", () => {
  it("lists chat apps from the channel plugins and channels.status, without starting a probe", async () => {
    const request = await open("Chat apps");
    expect(request).toHaveBeenCalledWith("channels.status", { probe: false });
    const cards = [...host.querySelectorAll(".cz-ch")].map(c => c.querySelector(".grow > b")?.textContent);
    expect(cards).toEqual(["Telegram", "Discord", "Slack", "IRC"]);
    expect(host.textContent).toContain("Configured · not running");
    expect(host.textContent).toContain("Connected · reaches Branch");
    expect((host.querySelector('input[aria-label="Search chat apps"]') as HTMLInputElement).placeholder).toBe("Search 4 chat apps");
    await click(button("Work chat"));
    expect(host.textContent).toContain("No chat apps yet.");
  });
  it("starts, pauses and signs out an account, and switches an app's plugin on", async () => {
    const request = await open("Chat apps");
    await click([...host.querySelectorAll(".cz-ch")].find(c => c.textContent?.includes("Telegram")));
    expect(host.querySelector('[data-testid="channel"]')?.getAttribute("aria-label")).toBe("Manage Telegram");
    await click(button("Start"));
    expect(request).toHaveBeenCalledWith("channels.start", { channel: "telegram", accountId: "default" });
    await click(button("Disconnect"));
    expect(request).toHaveBeenCalledWith("channels.logout", { channel: "telegram", accountId: "default" });
    await click(button("Done"));
    await click([...host.querySelectorAll(".cz-ch")].find(c => c.textContent?.includes("Discord")));
    await click(button("Pause"));
    expect(request).toHaveBeenCalledWith("channels.stop", { channel: "discord", accountId: "default" });
    await click(button("Done"));
    await click([...host.querySelectorAll(".cz-ch")].find(c => c.textContent?.includes("Slack")));
    await click(button("Switch it on"));
    expect(request).toHaveBeenCalledWith("plugins.setEnabled", { pluginId: "slack", enabled: true });
  });
  it("makes a pairing code from the phone tile", async () => {
    const request = await open("Chat apps", { "device.pair.setupCode": { setupId: "s1", setupCode: "ABCD-EFGH", qrDataUrl: "data:image/png;base64,AA==", gatewayUrl: "ws://x", auth: "token", urlSource: "lan" } });
    await click(button("Pair a phone"));
    await click(button("Make the code"));
    expect(request).toHaveBeenCalledWith("device.pair.setupCode", { includeQr: true });
    expect(host.textContent).toContain("ABCD-EFGH");
  });
});

describe("Customize › Everywhere", () => {
  it("shows the surface tiles from the engine's computers and devices, with no models section", async () => {
    const request = await open("Everywhere");
    expect(request).not.toHaveBeenCalledWith("models.list", expect.anything());
    expect(host.textContent).not.toContain("MODELS");
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
  it("pairs from a phone tile and opens Chat apps", async () => {
    const request = await open("Everywhere", { "device.pair.setupCode": { setupId: "s1", setupCode: "WXYZ-1234", gatewayUrl: "ws://x", auth: "token", urlSource: "lan" } });
    await click(button("Pair", host.querySelector('[data-surface="Android"]')!));
    await click(host.querySelectorAll('input[name="pair-access"]')[1]);
    await click(button("Make the code"));
    expect(request).toHaveBeenCalledWith("device.pair.setupCode", { includeQr: true, bootstrapProfile: "limited" });
    await click(button("Done"));
    await click(button("Chat apps", host.querySelector('[data-surface="Chat apps"]')!));
    expect(host.querySelector('[aria-label="Customize"] [aria-selected="true"]')?.textContent).toBe("Chat apps");
  });
});

describe("Customize tabs", () => {
  it("shows the Trunk count on the Trunks tab, from agents.list", async () => {
    await open("Trunks");
    const trunksTab = host.querySelector('[aria-label="Customize"] [role="tab"]')!;
    expect(trunksTab.textContent).toBe("Trunks");
    expect(trunksTab.getAttribute("data-count")).toBe("2");
    expect(trunksTab.getAttribute("aria-label")).toBe("Trunks, 2");
  });
});
