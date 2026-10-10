// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { ChatAppsPage, CHATAPPS_ROWS } from "./chatapps";
import { appOf, catalogue } from "./chatapps-data";
import { chatsOf, withRoute, type Binding } from "./chatapps-who";
import { actionsAfter } from "./chatapps-people";
import { fieldsOf } from "./chatapps-manage-more";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const now = Date.now();
const META = [{ id: "discord", label: "Discord", detailLabel: "Discord Bot" }, { id: "telegram", label: "Telegram", detailLabel: "Telegram Bot" }, { id: "slack", label: "Slack", detailLabel: "Slack Bot" }];
const STATUS = {
  ts: now, channelOrder: ["discord", "telegram", "slack"], channelLabels: { discord: "Discord", telegram: "Telegram", slack: "Slack" }, channelMeta: META,
  channels: { discord: { configured: true }, telegram: { configured: true }, slack: { configured: false } },
  channelAccounts: {
    discord: [{ accountId: "default", configured: true, running: true, connected: true, healthState: "healthy", lastTransportActivityAt: now - 4000, tokenSource: "config" }],
    telegram: [{ accountId: "default", configured: true, running: false, lastError: "401 Unauthorized: the bot token was revoked." }],
  },
  channelDefaultAccountId: { discord: "default", telegram: "default" },
};
const PAIRING = {
  accounts: [{ channel: "telegram", channelLabel: "Telegram", accountId: "default", accountLabel: "@bot", notifySupported: true }],
  requests: [{ requestId: "r1", channel: "telegram", channelLabel: "Telegram", accountId: "default", accountLabel: "@bot", senderId: "551", senderLabel: "Person A", createdAt: new Date(now - 60000).toISOString(), lastSeenAt: new Date(now).toISOString(), expiresAt: new Date(now + 3000000).toISOString(), notifySupported: true }],
  commandOwnerConfigured: true, limits: { pendingPerAccount: 3, ttlMs: 3600000 },
};
const AGENTS = { defaultId: "main", agents: [{ id: "main", identity: { name: "Oak" } }, { id: "two", identity: { name: "Birch" } }] };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(extra: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method in extra) return extra[method];
    if (method === "channels.status") return STATUS;
    if (method === "channels.pairing.list") return PAIRING;
    if (method === "agents.list") return AGENTS;
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.patch") return { ok: true, hash: "h2", config: {} };
    if (method === "wizard.start") return { sessionId: "w1", done: false, step: { id: "s1", type: "text", title: "Bot token" } };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
  return { engine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0) {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={null}><ChatAppsPage page="chatapps" title="Chat apps" level="regular" engine={engine} /></KitProvider>));
}
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const patchOf = (request: ReturnType<typeof engineOf>["request"]) => JSON.parse((request.mock.calls.filter(([m]) => m === "config.patch").at(-1) as unknown as [string, { raw: string }])[1].raw);

describe("Settings › Chat apps", () => {
  it("lists connected apps from channels.status with the pill mapped from the engine's state", async () => {
    const { engine } = engineOf();
    await render(engine);
    const rows = [...host.querySelectorAll(".prow")].slice(0, 2);
    expect(rows.map((r) => r.querySelector("b")?.textContent)).toEqual(["Discord", "Telegram"]);
    expect(rows[0].querySelector(".pill")?.textContent).toBe("Online");
    expect(rows[1].querySelector(".pill")?.textContent).toBe("Offline");
    expect(rows[1].textContent).toContain("the bot token was revoked");
    expect(button("All 3 chat apps")).toBeTruthy();
  });

  it("shows reconnect needs-attention while automatic retries continue", async () => {
    const status = {
      ...STATUS,
      channelAccounts: {
        ...STATUS.channelAccounts,
        telegram: [{
          ...STATUS.channelAccounts.telegram[0],
          needsAttention: true,
          restartPending: true,
          reconnectAttempts: 24,
        }],
      },
    };
    const { engine } = engineOf({ "channels.status": status });
    await render(engine);
    const row = [...host.querySelectorAll(".prow")].find((element) =>
      element.textContent?.includes("Telegram"),
    );
    expect(row?.querySelector(".pill")?.textContent).toBe("Needs attention");
    expect(row?.textContent).toContain("Reconnect attempts continue automatically");
  });

  it("opens the real watchdog log from Technical chat-app settings", async () => {
    const { engine, request } = engineOf({
      "logs.tail": {
        file: "branch.log",
        cursor: 1,
        lines: ["gateway/health-monitor: [telegram:default] restarting (reason: disconnected)"],
      },
    });
    await render(engine, 2);
    await act(async () => button("Open watchdog log").click());
    expect(request).toHaveBeenCalledWith("logs.tail", { limit: 500 });
    expect(document.querySelector(".dlg")?.textContent).toContain("restarting (reason: disconnected)");
  });

  it("says no chat app is connected yet, and hides Asking and Who answers", async () => {
    const { engine } = engineOf({ "channels.status": { ...STATUS, channels: {}, channelAccounts: {} } });
    await render(engine);
    expect(host.textContent).toContain("No chat app is connected yet.");
    expect(host.textContent).not.toContain("Asking to message");
    expect(host.querySelector('[data-sec="Who answers"]')).toBeNull();
  });

  it.each([0, 1, 2] as const)("offers setup without irrelevant settings for an empty catalogue at level %s", async (level) => {
    const { engine, request } = engineOf({ "channels.status": {} });
    await render(engine, level);
    expect(host.textContent).toContain("Message your Trunks from Telegram, WhatsApp, Slack");
    expect(host.textContent).not.toContain("All 0 chat apps");
    expect(host.querySelector("[data-sec]")).toBeNull();
    const connect = button("Connect a chat app", host);
    expect(connect).toBeTruthy();
    expect(connect.disabled).toBe(false);
    await act(async () => connect.click());
    expect(request).toHaveBeenCalledWith("wizard.start", { flow: "channels" });
    expect(document.querySelector(".dlg")?.textContent).toContain("Bot token");
  });

  it("offers setup before any app is configured even when the catalogue is populated", async () => {
    const { engine, request } = engineOf({ "channels.status": { ...STATUS, channels: {}, channelAccounts: {} } });
    await render(engine, 1);
    expect(host.querySelector('[data-sec="Commands in chat apps"]')).toBeNull();
    expect(button("All 3 chat apps", host)).toBeTruthy();
    await act(async () => button("Connect a chat app", host).click());
    expect(request).toHaveBeenCalledWith("wizard.start", { flow: "channels" });
  });

  it("approves a request through channels.pairing.approve, telling them when asked", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    expect(host.textContent).toContain("Requests expire after 60 minutes. Each account holds up to 3 waiting.");
    await act(async () => button("Allow", host).click());
    expect(document.querySelector(".dlg h2")?.textContent).toBe("Let Person A message Oak?");
    await act(async () => document.querySelector<HTMLInputElement>('.dlg input[type="checkbox"]')!.click());
    await act(async () => button("Allow", document.querySelector(".dlg")!).click());
    expect(request).toHaveBeenCalledWith("channels.pairing.approve", { channel: "telegram", accountId: "default", requestId: "r1", notify: true });
  });

  it("Who answers in an app saves an app-wide route binding", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    const seg = host.querySelector('[aria-label="Who answers in Discord"]')!;
    await act(async () => button("Birch", seg).click());
    expect(patchOf(request)).toEqual({ bindings: [{ agentId: "two", match: { channel: "discord", accountId: "*" } }] });
  });

  it("shows the five messaging policies as one radio list in the manage dialog", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    await act(async () => button("Open", [...host.querySelectorAll(".prow")].find((row) => row.textContent?.includes("Telegram"))!).click());
    const radios = [...document.querySelectorAll<HTMLButtonElement>('.dlg [role="radiogroup"][aria-label="Who may message it"] [role="radio"]')];
    expect(radios.map((radio) => radio.textContent?.trim().replace(/^✓/, ""))).toEqual(["Only meAdd yourself below first.", "People I approve", "Anyone in my workspaceBranch can’t tell who is in your workspace yet.", "Anyone", "No one"]);
    expect(radios.filter((radio) => radio.getAttribute("aria-checked") === "true").map((radio) => radio.textContent)).toEqual(["✓People I approve"]);
    await act(async () => button("No one", document.querySelector(".dlg")!).click());
    expect(patchOf(request)).toEqual({ channels: { telegram: { dmPolicy: "disabled" } } });
  });

  it("shows Advanced sections only at Advanced, and the key list only at Technical", async () => {
    const { engine } = engineOf();
    await render(engine, 0);
    expect(host.querySelector('[data-sec="How replies arrive"]')).toBeNull();
    await render(engine, 1);
    expect(host.querySelector('[data-sec="How replies arrive"]')).not.toBeNull();
    expect(host.querySelector('[data-sec="Messages, every setting"]')).toBeNull();
    await render(engine, 2);
    expect(host.querySelector('[data-sec="Messages, every setting"]')).not.toBeNull();
  });

  it("an Advanced switch saves its engine key at once", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Run ! commands from chat apps"]')!.click());
    expect(patchOf(request)).toEqual({ commands: { bash: true } });
  });

  it("connecting an app starts the engine's channel-setup wizard and shows its step", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    await act(async () => button("All 3 chat apps").click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".dlg .prov")].find((b) => b.textContent?.includes("Slack"))!.click());
    expect(request).toHaveBeenCalledWith("wizard.start", { flow: "channels", channel: "slack" });
    expect(document.querySelector(".dlg")?.textContent).toContain("Bot token");
  });

  it("route bindings keep every other entry", () => {
    const other: Binding = { type: "acp", agentId: "x", match: { channel: "discord", peer: { kind: "group", id: "g" } } };
    const bs = withRoute([other, { agentId: "a", match: { channel: "telegram", accountId: "*" } }], "telegram", null, "b");
    expect(bs).toEqual([other, { agentId: "b", match: { channel: "telegram", accountId: "*" } }]);
    expect(withRoute(bs, "telegram", null, null)).toEqual([other]);
  });

  it("reads group chats from conversation keys and direct chats only where the engine names the person", () => {
    const chats = chatsOf([{ key: "agent:main:telegram:group:-100", displayName: "Family" }, { key: "agent:main:main", origin: { provider: "telegram", chatType: "direct" } }], [], "telegram");
    expect(chats).toEqual([{ peer: { kind: "group", id: "-100" }, name: "Family", kind: "Group" }]);
  });

  it("turning off one kind of action writes the engine's allow list without it", () => {
    const next = actionsAfter(undefined, ["pin", "unpin", "list-pins"], false)!;
    expect(next).not.toContain("pin");
    expect(next).toContain("send");
    expect(actionsAfter(next, ["pin", "unpin", "list-pins"], true)).toBeNull();
  });

  it("names every app from the engine's catalogue and lists rows for search", () => {
    expect(catalogue(STATUS as never).map((c) => c.name)).toEqual(["Discord", "Telegram", "Slack"]);
    expect(appOf(STATUS as never, { id: "discord", name: "Discord", detail: "" }).word).toBe("Online");
    expect(CHATAPPS_ROWS.some((r) => r.title === "Show typing" && r.lv === 1)).toBe(true);
  });

  it("All settings reads the app's keys from the schema lookup's children", () => {
    const f = fieldsOf([{ key: "enabled", type: "boolean", hasChildren: false }, { key: "groups", type: "object", hasChildren: true }, { key: "historyLimit", type: ["integer", "null"], hasChildren: false }], {});
    expect(f).toEqual([{ key: "enabled", type: "boolean", opts: undefined }, { key: "historyLimit", type: "integer", opts: undefined }]);
  });

  it("Pause turns the app off in config and stops each of its accounts", async () => {
    const two = { ...STATUS, channelAccounts: { ...STATUS.channelAccounts, discord: [STATUS.channelAccounts.discord[0], { accountId: "second", configured: true, running: true }] } };
    const { engine, request } = engineOf({ "channels.status": two });
    await render(engine);
    await act(async () => button("Open", host).click());
    expect(document.querySelector(".dlg .box-h-ca .pill")?.textContent).toBe("Online");
    expect(document.querySelector(".dlg .chw-steps12")).toBeNull();
    expect(document.querySelector(".dlg")?.textContent).not.toContain("is ready");
    await act(async () => button("Pause", document.querySelector(".dlg")!).click());
    expect(patchOf(request)).toEqual({ channels: { discord: { enabled: false } } });
    expect(request).toHaveBeenCalledWith("channels.stop", { channel: "discord", accountId: "default" });
    expect(request).toHaveBeenCalledWith("channels.stop", { channel: "discord", accountId: "second" });
  });
});

describe("Settings › Chat apps on a partial engine reply", () => {
  it("renders every level, without crashing, when pairing and other replies are empty", async () => {
    const request = vi.fn(async (method: string) => (method === "channels.status" ? STATUS : {}));
    const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
    for (const level of [0, 1, 2] as const) {
      await render(engine, level);
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(host.querySelector("h1")?.textContent).toBe("Chat apps");
    }
  });
});
