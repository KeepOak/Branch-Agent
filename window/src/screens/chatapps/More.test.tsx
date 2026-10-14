// @vitest-environment jsdom
// Classic Settings › Chat apps controls ported to the R1 Chat apps screen (README rule 6): each asserts the engine call it makes.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { ChatApps } from "./ChatApps";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => localStorage.clear());
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const METHODS = ["channels.status", "channels.pairing.list", "channels.pairing.approve", "channels.pairing.dismiss", "wizard.start", "wizard.next", "wizard.cancel", "config.get", "config.patch", "agents.list", "sessions.list", "logs.tail"];
const STATUS = {
  channelMeta: [{ id: "telegram", label: "Telegram", detailLabel: "" }, { id: "signal", label: "Signal", detailLabel: "" }, { id: "matrix", label: "Matrix", detailLabel: "" }, { id: "nostrish", label: "Nostrish", detailLabel: "Relay chat" }],
  channelAccounts: { telegram: [{ accountId: "main", running: true, configured: true }], signal: [{ accountId: "default", running: true, configured: true }] },
};
const PAIRING = { accounts: [{ channel: "telegram", channelLabel: "Telegram", accountId: "main", notifySupported: true }], requests: [{ requestId: "r1", channel: "telegram", channelLabel: "Telegram", accountId: "main", senderId: "4242", senderLabel: "Ada", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), notifySupported: true }], commandOwnerConfigured: false, limits: { ttlMs: 3600000, pendingPerAccount: 3 } };

async function render(level: "regular" | "advanced" | "technical" = "regular", config: Record<string, unknown> = {}) {
  localStorage.setItem("branch.level", level);
  let live = structuredClone(config);
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "config.patch") { live = mergePatch(live, JSON.parse((params as { raw: string }).raw)); return {}; }
    if (method === "channels.status") return STATUS;
    if (method === "channels.pairing.list") return PAIRING;
    if (method === "config.get") return { config: live, hash: "h1", valid: true };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Sapling" }, { id: "scout", name: "Scout" }] };
    if (method === "sessions.list") return { sessions: [{ key: "agent:main:telegram:group:-100777", displayName: "Family" }] };
    return {};
  });
  const engine = { request, sessionKey: null, scopes: ["operator.admin"], onEvent: () => () => {}, features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  const setup = vi.fn(), manage = vi.fn();
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const { Access } = await import("./Access");
  await act(async () => root!.render(<ChatApps engine={engine} onSetup={setup} onManage={manage} renderAccess={(app) => <Access engine={engine} app={app} />} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { host, request, setup, manage };
}
const mergePatch = (into: Record<string, unknown>, patch: Record<string, unknown>) => { for (const [k, v] of Object.entries(patch)) { if (v === null) delete into[k]; else if (v && typeof v === "object" && !Array.isArray(v)) { const cur = into[k]; into[k] = mergePatch(cur && typeof cur === "object" && !Array.isArray(cur) ? { ...(cur as Record<string, unknown>) } : {}, v as Record<string, unknown>); } else into[k] = v; } return into; };
const patches = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse((p as { raw: string }).raw));
const button = (host: Element, label: string, scope: Element = host) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
const choose = async (el: HTMLSelectElement | HTMLInputElement, value: string, event = "change") => act(async () => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(event === "change" && el instanceof HTMLInputElement ? "input" : event, { bubbles: true }));
});

it("lists every app the engine runs, not only the R1 four, and opens Manage for it (Classic's Connected list)", async () => {
  const { host, manage } = await render();
  const list = host.querySelector('[aria-label="Connected chat apps"]')!;
  expect(list.textContent).toContain("Signal");
  await act(async () => button(host, "Open", [...list.children].find((c) => c.textContent?.includes("Signal"))!).click());
  expect(manage).toHaveBeenCalledWith(expect.objectContaining({ id: "signal", channel: "signal" }));
});

it("sets up any app the engine has through its wizard, and has no Find another app button (#1049: not in the preview)", async () => {
  const { host, setup, request } = await render();
  const matrix = [...host.querySelectorAll<HTMLButtonElement>(".r1-ca-card")].find((b) => b.textContent?.includes("Matrix"))!;
  expect(matrix.getAttribute("aria-disabled")).toBe("false");
  await act(async () => matrix.click());
  expect(setup).toHaveBeenLastCalledWith(expect.objectContaining({ id: "matrix", channel: "matrix" }));
  const extra = [...host.querySelectorAll<HTMLButtonElement>(".r1-ca-card")].find((b) => b.textContent?.includes("Nostrish"))!;
  await act(async () => extra.click());
  expect(setup).toHaveBeenLastCalledWith(expect.objectContaining({ channel: "nostrish" }));
  // Every app the engine has is its own card (Nostrish above), so the preview has no Find another app.
  expect([...host.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Find another app");
  expect(document.querySelector('[data-testid="chatapps-connect"]')).toBeNull();
  expect(request).not.toHaveBeenCalledWith("wizard.start", { flow: "channels" });
});

it("approves a request with Tell them and make them the owner (channels.pairing.approve notify, bootstrapCommandOwner)", async () => {
  const { host, request } = await render("advanced");
  expect(host.querySelector('[aria-label="Which app"]')).not.toBeNull();
  expect(host.textContent).toContain("4242");
  await act(async () => button(host, "Approve").click());
  const confirm = host.querySelector('[aria-label="Confirm approval"]')!;
  expect(confirm.textContent).toContain("message Sapling");
  for (const box of confirm.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await act(async () => box.click());
  await act(async () => button(host, "Approve request").click());
  expect(request).toHaveBeenCalledWith("channels.pairing.approve", { channel: "telegram", accountId: "main", requestId: "r1", notify: true, bootstrapCommandOwner: true });
});

it("chooses who answers in one chat (a chat-level route in bindings), as Classic's Who answers does", async () => {
  const { host, request } = await render();
  const chat = host.querySelector<HTMLSelectElement>('select[aria-label="Who answers in Family"]')!;
  expect(chat).not.toBeNull();
  await choose(chat, "scout");
  expect(patches(request).at(-1)).toEqual({ bindings: [{ agentId: "scout", match: { channel: "telegram", accountId: "*", peer: { kind: "group", id: "-100777" } } }] });
});

it("draws Classic's Advanced tables: a table row saves its key and a row Classic greys stays Coming", async () => {
  const { host, request } = await render("advanced");
  // Typed commands (commands.text) is one of the page's own rows, so it is drawn there only, never twice.
  expect(host.querySelector("#row-chatapps\\.more\\.commands-from-chat-apps\\.typed-commands")).toBeNull();
  const bang = host.querySelector<HTMLButtonElement>('#row-chatapps\\.more\\.commands-from-chat-apps\\.run-commands-from-chat-apps [role="switch"]')!;
  expect(bang.getAttribute("aria-checked")).toBe("false");
  await act(async () => bang.click());
  expect(patches(request).at(-1)).toEqual({ commands: { bash: true } });
  const edited = host.querySelector<HTMLElement>("#row-chatapps\\.more\\.what-the-trunk-sees\\.edited-messages")!;
  expect(edited.dataset.coming).toBeTruthy();
  expect(edited.getAttribute("aria-disabled")).toBe("true");
});

it("edits owners in chat apps (commands.ownerAllowFrom)", async () => {
  const { host, request } = await render("advanced");
  await act(async () => button(host, "Edit", host.querySelector('[data-sec="Commands from chat apps"]')!).click());
  const editor = host.querySelector('[aria-label="Owners in chat apps"][role="group"]')!;
  await choose(editor.querySelector<HTMLInputElement>('input[aria-label="Their ID or @name"]')!, "4242");
  await act(async () => button(host, "Add", editor).click());
  expect(patches(request).at(-1)).toEqual({ commands: { ownerAllowFrom: ["telegram:4242"] } });
});

it("names who may use commands (commands.allowFrom) and the actions Trunks may take (tools.message.actions.allow)", async () => {
  const { host, request } = await render("advanced");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Who may use commands"] button')].find((b) => b.textContent === "Only these people")!.click());
  const editor = host.querySelector('[aria-label="These people"]')!;
  await choose(editor.querySelector<HTMLInputElement>('input[aria-label="Their ID or @name"]')!, "ada");
  await act(async () => button(host, "Add", editor).click());
  expect(patches(request).at(-1)).toEqual({ commands: { allowFrom: { telegram: ["ada"] } } });
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Pin messages"]')!.click());
  const allow = (patches(request).at(-1) as { tools: { message: { actions: { allow: string[] } } } }).tools.message.actions.allow;
  expect(allow).not.toContain("pin");
  expect(allow).toContain("react");
});

it("creates a list of people (accessGroups.<name>)", async () => {
  const { host, request } = await render("advanced");
  await act(async () => button(host, "New list").click());
  const editor = host.querySelector('[aria-label="New list"]')!;
  await choose(editor.querySelector<HTMLInputElement>('input[aria-label="Name"]')!, "family");
  await act(async () => editor.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  await choose(editor.querySelector<HTMLInputElement>('input[aria-label="Their ID"]')!, "ada");
  await act(async () => button(host, "Add", editor).click());
  await act(async () => button(host, "Save", editor).click());
  expect(patches(request).at(-1)).toEqual({ accessGroups: { family: { type: "message.senders", members: { telegram: ["ada"] } } } });
});

it("sends approvals to chats it picks (approvals.exec.targets) once approvals go to chat apps", async () => {
  const { host, request } = await render("advanced", { approvals: { exec: { enabled: true, mode: "targets" } } });
  const editor = host.querySelector('[aria-label="Chats approvals go to"]')!;
  await choose(editor.querySelector<HTMLInputElement>('input[aria-label="Chat"]')!, "-100777");
  await act(async () => button(host, "Add a chat", editor).click());
  expect(patches(request).at(-1)).toEqual({ approvals: { exec: { targets: [{ channel: "telegram", to: "-100777" }] } } });
});

it("keeps each app in depth (a connected app's own key) and, at Technical, every message key with Back to default", async () => {
  const { host, request } = await render("technical", { messages: { usageTemplate: "{tokens}" } });
  const live = host.querySelector<HTMLElement>('[aria-label="Live typing"]')!;
  await act(async () => [...live.querySelectorAll("button")].find((b) => b.textContent === "One message")!.click());
  expect(patches(request).at(-1)).toEqual({ channels: { telegram: { streaming: { mode: "partial" } } } });
  const usage = [...host.querySelectorAll<HTMLElement>(".r1-ca-line")].find((l) => l.textContent?.includes("messages.usageTemplate"))!;
  await act(async () => button(host, "Back to default", usage).click());
  expect(patches(request).at(-1)).toEqual({ messages: { usageTemplate: null } });
});

it("opens the watchdog log (logs.tail) and turns the watch off on every connected app (healthMonitor.enabled)", async () => {
  const { host, request } = await render("technical");
  await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Watch for a chat app that stops receiving"]')!.click());
  expect(patches(request).slice(-2)).toEqual([{ channels: { telegram: { healthMonitor: { enabled: false } } } }, { channels: { signal: { healthMonitor: { enabled: false } } } }]);
  await act(async () => button(host, "Open watchdog log").click());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(request.mock.calls.some(([m]) => m === "logs.tail")).toBe(true);
});
