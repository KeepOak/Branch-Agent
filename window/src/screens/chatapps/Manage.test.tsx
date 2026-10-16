// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Manage } from "./Manage";
import { CHAT_APPS } from "./catalogue";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
beforeEach(() => localStorage.clear());
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ""; });
const BASE = ["channels.status", "channels.start", "channels.stop", "channels.logout"];
const LOOKUP = { schema: { properties: { groupPolicy: { type: "string" }, groups: { type: "object" }, configWrites: { type: "boolean" }, commands: { type: "object" }, streaming: { type: "string", enum: ["off", "partial"] }, botToken: { type: "string" }, historyLimit: { type: "integer" } } }, children: [] };
async function render(fail = false, config: Record<string, unknown> = {}, opts: { methods?: string[]; level?: string; accounts?: unknown[] } = {}) {
  if (opts.level) localStorage.setItem("branch.level", opts.level);
  let live = structuredClone(config);
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "config.patch") { live = mergePatch(live, JSON.parse((params as { raw: string }).raw)); return {}; }
    if (method === "channels.status") return { channelAccounts: { telegram: opts.accounts ?? [{ accountId: "selected", running: true, configured: true, botTokenSource: "config" }] } };
    if (method === "config.get") return { config: live, hash: "fixture", valid: true };
    if (method === "config.schema.lookup") return LOOKUP;
    if (method === "agents.list") return { agents: [] };
    if (method === "channels.logout" && fail) throw new Error("Unlink failed");
    return {};
  });
  const engine = { request, sessionKey: null, scopes: ["operator.admin"], onEvent: () => () => {}, features: { methods: opts.methods ?? BASE, events: [] } } as WindowEngine;
  const onSetup = vi.fn(), onClose = vi.fn();
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Manage engine={engine} app={CHAT_APPS.find(a => a.id === "telegram")!} onClose={onClose} onSetup={onSetup} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { host, request, onSetup, onClose };
}
const ADMIN = [...BASE, "config.get", "config.patch", "config.schema.lookup", "agents.list"];
const mergePatch = (into: Record<string, unknown>, patch: Record<string, unknown>) => { for (const [k, v] of Object.entries(patch)) { if (v === null) delete into[k]; else if (v && typeof v === "object" && !Array.isArray(v)) { const cur = into[k]; into[k] = mergePatch(cur && typeof cur === "object" && !Array.isArray(cur) ? { ...(cur as Record<string, unknown>) } : {}, v as Record<string, unknown>); } else into[k] = v; } return into; };
const patches = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse((p as { raw: string }).raw));
function button(host: Element, label: string) { return [...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!; }
const type = async (el: HTMLInputElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
const pick = async (el: HTMLSelectElement, value: string) => act(async () => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });

const LINKED = [{ accountId: "selected", running: true, configured: true, linked: true }];
it("#1049: shows Unlink only for a linked account, and no Set up again in the row", async () => {
  const plain = await render(false, {}, { methods: ADMIN });
  const labels = [...plain.host.querySelectorAll(".r1-cw-actions button")].map((b) => b.textContent);
  expect(labels).not.toContain("Unlink");
  expect(labels).not.toContain("Set up again");
  expect(button(plain.host, "Disconnect")).toBeTruthy();
});
it("pauses the app and confirms before unlinking", async () => {
  const { host, request } = await render(false, {}, { methods: ADMIN, accounts: LINKED });
  await act(async () => button(host, "Pause").click());
  expect(request).toHaveBeenCalledWith("channels.stop", { channel: "telegram", accountId: "selected" });
  await act(async () => button(host, "Unlink").click());
  expect(request.mock.calls.some(([m]) => m === "channels.logout")).toBe(false);
  await act(async () => button(host, "Unlink account").click());
  expect(request).toHaveBeenCalledWith("channels.logout", { channel: "telegram", accountId: "selected" });
  expect(host.textContent).toContain("Adapters arrive after release.");
});
it("keeps a rejected unlink visible instead of claiming success", async () => {
  const { host } = await render(true, {}, { accounts: LINKED });
  await act(async () => button(host, "Unlink").click());
  await act(async () => button(host, "Unlink account").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Unlink failed");
  expect(host.querySelector('[aria-label="Confirm unlink"]')).not.toBeNull();
});
it("offers Only me once people are named, and keeps its people when the policy changes", async () => {
  const { host, request } = await render(false, { channels: { telegram: { dmPolicy: "allowlist", allowFrom: ["ada", "bo"] } } }, { methods: ADMIN });
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Who may message Telegram"]')!;
  const only = [...select.options].find(o => o.value === "allowlist")!;
  expect(only.disabled).toBe(false);
  expect(only.textContent).toBe("Only me");
  expect([...select.options].find(o => o.value === "workspace")!.disabled).toBe(true);
  await pick(select, "pairing");
  expect(patches(request)[0]).toEqual({ channels: { telegram: { dmPolicy: "pairing", allowFrom: ["ada", "bo"] } } });
});
it("edits the allowlist: adds and removes people and uses a list (channels.<id>.allowFrom)", async () => {
  const { host, request } = await render(false, { channels: { telegram: { dmPolicy: "allowlist", allowFrom: ["ada"] } }, accessGroups: { family: { type: "message.senders", members: {} } } }, { methods: ADMIN });
  const editor = host.querySelector('[aria-label="Allowed to message it"]')!;
  await type(editor.querySelector<HTMLInputElement>('input[aria-label="Their Telegram ID or @name"]')!, "bo");
  await act(async () => button(editor, "Add").click());
  expect(patches(request).at(-1)).toEqual({ channels: { telegram: { allowFrom: ["ada", "bo"] } } });
  await act(async () => button(editor, "Remove").click());
  expect(patches(request).at(-1)).toEqual({ channels: { telegram: { allowFrom: ["bo"] } } });
  await pick(editor.querySelector<HTMLSelectElement>('select[aria-label="Use a list"]')!, "family");
  expect(patches(request).at(-1)).toEqual({ channels: { telegram: { allowFrom: ["bo", "accessGroup:family"] } } });
});
it("keeps a pause after a restart (channels.<id>.enabled) and disconnects every account, then forgets the app", async () => {
  const { host, request, onClose } = await render(false, {}, { methods: ADMIN });
  await act(async () => button(host, "Pause").click());
  expect(patches(request)[0]).toEqual({ channels: { telegram: { enabled: false } } });
  expect(request).toHaveBeenCalledWith("channels.stop", { channel: "telegram", accountId: "selected" });
  await act(async () => button(host, "Disconnect").click());
  await act(async () => button(host, "Disconnect Telegram").click());
  expect(patches(request).at(-1)).toEqual({ channels: { telegram: null } });
  expect(onClose).toHaveBeenCalled();
});
it("waits for the settings before Pause or Start, so a change is never sent without being kept", async () => {
  const { host, request } = await render();
  expect(button(host, "Pause").disabled).toBe(true);
  await act(async () => button(host, "Pause").click());
  expect(request.mock.calls.some(([m]) => m === "channels.stop" || m === "channels.start")).toBe(false);
});
it("follows the whole app for Pause or Start: one running account makes it Pause, for every account", async () => {
  const accounts = [{ accountId: "selected", running: false, configured: true }, { accountId: "other", running: true, configured: true }];
  const { host, request } = await render(false, {}, { methods: ADMIN, accounts });
  expect(button(host, "Start")).toBeUndefined();
  await act(async () => button(host, "Pause").click());
  expect(request).toHaveBeenCalledWith("channels.stop", { channel: "telegram", accountId: "selected" });
  expect(request).toHaveBeenCalledWith("channels.stop", { channel: "telegram", accountId: "other" });
  expect(request.mock.calls.some(([m]) => m === "channels.start")).toBe(false);
});
it("replaces the token through the setup steps", async () => {
  const { host, onSetup } = await render();
  expect(host.textContent).toContain("Kept in the settings file");
  await act(async () => button(host, "Replace").click());
  expect(onSetup).toHaveBeenCalled();
});
it("at Advanced: adds a group by ID, sets when it answers, checks now and adds another account", async () => {
  const { host, request, onSetup } = await render(false, { channels: { telegram: { groups: { "-1001": { requireMention: true } } } } }, { methods: ADMIN, level: "advanced" });
  await type(host.querySelector<HTMLInputElement>('input[aria-label="Group ID"]')!, "-1002");
  await act(async () => button(host, "Add a group by ID").click());
  expect(patches(request).at(-1)).toEqual({ channels: { telegram: { groups: { "-1002": {} } } } });
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Answers when in -1001"] button')].find(b => b.textContent === "Every message")!.click());
  expect(patches(request).at(-1)).toEqual({ channels: { telegram: { groups: { "-1001": { requireMention: false } } } } });
  await act(async () => button(host, "Check now").click());
  expect(request).toHaveBeenCalledWith("channels.status", { probe: true, channel: "telegram" });
  await act(async () => button(host, "Add another account").click());
  expect(onSetup).toHaveBeenCalled();
});
it("at Technical: changes the app's own settings, Reload drops the draft and Save writes it", async () => {
  const { host, request } = await render(false, {}, { methods: ADMIN, level: "technical" });
  const field = host.querySelector<HTMLSelectElement>('select[aria-label="streaming"]')!;
  expect(host.querySelector('input[aria-label="botToken"]')).toBeNull();
  await pick(field, "partial");
  await act(async () => button(host, "Reload").click());
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="streaming"]')!.value).toBe("");
  await pick(host.querySelector<HTMLSelectElement>('select[aria-label="streaming"]')!, "partial");
  await act(async () => button(host, "Save").click());
  expect(patches(request).at(-1)).toEqual({ channels: { telegram: { streaming: "partial" } } });
});
