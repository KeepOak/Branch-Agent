// @vitest-environment jsdom
import { act } from "react";
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

describe("Customize tabs", () => {
  it("shows the Trunk count on the Trunks tab, from agents.list", async () => {
    await open("Trunks");
    const trunksTab = host.querySelector('[aria-label="Customize"] [role="tab"]')!;
    expect(trunksTab.textContent).toBe("Trunks");
    expect(trunksTab.getAttribute("data-count")).toBe("2");
    expect(trunksTab.getAttribute("aria-label")).toBe("Trunks, 2");
  });
  it("has only Trunks, Tools and Chat apps: Specialists and Everywhere moved to Settings (DA-55)", async () => {
    await open("Specialists");
    expect([...host.querySelectorAll('[aria-label="Customize"] [role="tab"]')].map(t => t.textContent)).toEqual(["Trunks", "Tools", "Chat apps"]);
    expect(host.querySelector('[aria-label="Customize"] [aria-selected="true"]')?.textContent).toBe("Trunks");
    expect(host.querySelector('[data-testid="specialists"]')).toBeNull();
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "customize", tab: "Everywhere" } })); });
    expect(host.querySelector('[data-testid="everywhere"]')).toBeNull();
  });
});
