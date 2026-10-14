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

describe("Customize › Chat apps (#1049)", () => {
  it("has no Chat apps tab: asking for it opens Settings › Chat apps", async () => {
    const openSettings = vi.fn();
    host = document.createElement("div"); document.body.append(host);
    root = createRoot(host);
    const engine = { request: async (method: string) => BASE[method] ?? { ok: true }, onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as unknown as WindowEngine;
    await act(async () => { root!.render(<CustomizePlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} openSettings={openSettings} level={"regular" as Level} />); });
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "customize", tab: "Chat apps" } })); });
    expect(openSettings).toHaveBeenCalledWith("chatapps");
    expect([...host.querySelectorAll('[aria-label="Customize"] [role="tab"]')].map(t => t.textContent)).toEqual(["Trunks", "Tools"]);
    expect(host.querySelector(".cz-chgrid")).toBeNull();
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
  it("has only Trunks and Tools: Specialists, Everywhere and Chat apps live in Settings (DA-55, #1049)", async () => {
    await open("Specialists");
    expect([...host.querySelectorAll('[aria-label="Customize"] [role="tab"]')].map(t => t.textContent)).toEqual(["Trunks", "Tools"]);
    expect(host.querySelector('[aria-label="Customize"] [aria-selected="true"]')?.textContent).toBe("Trunks");
    expect(host.querySelector('[data-testid="specialists"]')).toBeNull();
    await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "customize", tab: "Everywhere" } })); });
    expect(host.querySelector('[data-testid="everywhere"]')).toBeNull();
  });
});
