// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { ChatAppsPage } from "./chatapps";
import { DEPTH } from "./chatapps-depth";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ZALO_META = { id: "zalo", label: "Zalo", detailLabel: "Zalo Official Account" };
const ZALOUSER_META = { id: "zalouser", label: "Zalo Personal", detailLabel: "Zalo (Personal Account)" };
const STATUS = {
  channelOrder: ["zalo", "zalouser"],
  channelLabels: { zalo: "Zalo", zalouser: "Zalo Personal" },
  channelMeta: [ZALO_META, ZALOUSER_META],
  channels: { zalo: { configured: false }, zalouser: { configured: false } },
  channelAccounts: {},
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(config: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => {
    if (method === "channels.status") return STATUS;
    if (method === "channels.pairing.list") return { accounts: [], requests: [], limits: { pendingPerAccount: 3, ttlMs: 3600000 } };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", identity: { name: "Oak" } }] };
    if (method === "config.get") return { hash: "h1", valid: true, config };
    if (method === "config.patch") return { ok: true, hash: "h2", config };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
  return { engine, request };
}

const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine) {
  await act(async () => root.render(<KitProvider level={1} report={report} scope={null}><ChatAppsPage page="chatapps" title="Chat apps" level="advanced" engine={engine} /></KitProvider>));
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
}
const connectAs = (scope: ParentNode = host) => scope.querySelector<HTMLElement>('[aria-label="Connect as"]');
const choice = (label: string, scope: ParentNode = host) => [...(connectAs(scope)?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent === label);
const patchOf = (request: ReturnType<typeof engineOf>["request"]) => JSON.parse((request.mock.calls.filter(([m]) => m === "config.patch").at(-1) as unknown as [string, { raw: string }])[1].raw);

describe("Settings › Chat apps › Connect as (Zalo personal account)", () => {
  it("points Connect as at the engine’s zalouser channel, not a made-up zalo key", () => {
    expect(DEPTH.zalo[0]).toMatchObject({ t: "Connect as", path: "channels.zalouser.enabled" });
    expect(DEPTH.zalouser[0]).toMatchObject({ t: "Connect as", path: "channels.zalouser.enabled" });
    expect(DEPTH.zalo[0]).not.toHaveProperty("off");
    expect(DEPTH.zalo[0].opts).toEqual([["A bot", false], ["My personal account", true]]);
  });

  it("writes and reads channels.zalouser.enabled from Connect as", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    const row = host.querySelector('[data-row="Connect as"]')!;
    expect(row.getAttribute("aria-disabled")).toBeNull();
    expect(choice("A bot")?.getAttribute("aria-pressed")).toBe("true");
    expect(choice("My personal account")?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => choice("My personal account")!.click());
    expect(patchOf(request)).toEqual({ channels: { zalouser: { enabled: true } } });

    const { engine: on, request: requestOn } = engineOf({ channels: { zalouser: { enabled: true } } });
    await render(on);
    expect(choice("My personal account")?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => choice("A bot")!.click());
    expect(patchOf(requestOn)).toEqual({ channels: { zalouser: { enabled: false } } });
  });
});
