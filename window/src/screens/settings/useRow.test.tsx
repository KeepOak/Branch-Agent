// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { forgetLookStore } from "../../places/settings/set1/appearance-store";
import type { Row } from "./rows";
import { CHANGED_ELSEWHERE, INVALID_CONFIG, LOAD_FAILED, NEEDS_ADMIN, NEEDS_WRITE, NO_PERSON, schemaDefault, useRow, type RowView } from "./useRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

type Reply = unknown | ((params: Record<string, unknown>) => unknown);
function engineOf(table: Record<string, Reply> = {}, scopes: string[] = ["operator.admin"]) {
  const listeners = new Set<(e: { event: string; payload?: unknown }) => void>();
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method in table) { const r = table[method]; const v = typeof r === "function" ? (r as (p: Record<string, unknown>) => unknown)(params) : r; if (v instanceof Error) throw v; return v; }
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.patch") return { ok: true };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { path: params.path, reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "users.prefs.set") return { status: "ok" };
    if (method === "themes.list") return { current: {} };
    throw new Error(`unknown method: ${method}`);
  });
  const engine = { request, onEvent: (fn: (e: { event: string }) => void) => { listeners.add(fn); return () => listeners.delete(fn); }, sessionKey: "s", scopes } as unknown as WindowEngine;
  return { engine, request, fire: (event: string) => listeners.forEach((fn) => fn({ event })) };
}

let view: RowView;
function Probe({ engine, row }: { engine: WindowEngine; row: Row }) { view = useRow(engine, row); return null; }
async function mount(engine: WindowEngine, row: Row) {
  await act(async () => root.render(<Probe engine={engine} row={row} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const patches = (request: ReturnType<typeof engineOf>["request"]) => request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse((p as { raw: string }).raw));

const toggle: Row = { id: "general.x.lock", page: "general", card: "Writing", level: 0, control: "toggle", source: { kind: "config", path: "security.lockdown" } };

describe("useRow", () => {
  it("reads a config row, labels it from the schema and saves one path with config.patch", async () => {
    const { engine, request } = engineOf({
      "config.get": { hash: "h1", valid: true, config: { security: { lockdown: true } } },
      "config.schema": { schema: {}, uiHints: { "security.lockdown": { label: "Lockdown", help: "Stops every tool.", sensitive: false } } },
      "config.schema.lookup": { reloadKind: "restart" },
    });
    await mount(engine, toggle);
    expect(view).toMatchObject({ value: true, state: "ready", label: "Lockdown", help: "Stops every tool.", restart: true });
    await act(async () => { await view.set(false); });
    expect(patches(request)).toEqual([{ security: { lockdown: false } }]);
    expect(request).toHaveBeenCalledWith("config.patch", expect.objectContaining({ baseHash: "h1" }));
  });

  it("shows the schema default, then the row's own fallback, when nothing is stored", async () => {
    const schema = { properties: { messages: { properties: { queue: { properties: { cap: { type: "number", default: 12 } } } } } } };
    expect(schemaDefault(schema, "messages.queue.cap")).toBe(12);
    expect(schemaDefault({ anyOf: [{ type: "string" }, schema] }, "messages.queue.cap")).toBe(12);
    const row: Row = { id: "general.line.cap", page: "general", card: "Waiting line", level: 2, control: "number", source: { kind: "config", path: "messages.queue.cap" }, fallback: 20 };
    const first = engineOf({ "config.schema": { schema, uiHints: {} } });
    await mount(first.engine, row);
    expect(view.value).toBe(12);
    const second = engineOf();
    await mount(second.engine, row);
    expect(view.value).toBe(20);
  });

  it("converts through the row's codec both ways", async () => {
    const row: Row = { id: "general.x.trim", page: "general", card: "Writing", level: 0, control: "toggle", source: { kind: "config", path: "agents.defaults.contextPruning.mode" },
      codec: { read: (v) => (v ?? "off") !== "off", write: (on) => (on ? "cache-ttl" : "off") } };
    const { engine, request } = engineOf();
    await mount(engine, row);
    expect(view.value).toBe(false);
    await act(async () => { await view.set(true); });
    expect(patches(request)).toEqual([{ agents: { defaults: { contextPruning: { mode: "cache-ttl" } } } }]);
  });

  it("says when settings didn't load, and reloads on config.changed", async () => {
    let fail = true;
    const { engine, fire } = engineOf({ "config.get": () => (fail ? new Error("socket closed") : { hash: "h2", valid: true, config: { security: { lockdown: true } } }) });
    await mount(engine, toggle);
    expect(view).toMatchObject({ state: "error", reason: LOAD_FAILED });
    fail = false;
    await act(async () => { fire("config.changed"); await new Promise((r) => setTimeout(r, 0)); });
    expect(view).toMatchObject({ state: "ready", value: true });
  });

  it("says Changed somewhere else when the retry after a conflict fails too", async () => {
    const { engine } = engineOf({ "config.patch": new Error("config changed since last load; re-run config.get") });
    await mount(engine, toggle);
    await act(async () => { await view.set(true).catch(() => undefined); });
    expect(view).toMatchObject({ state: "error", reason: CHANGED_ELSEWHERE });
  });

  it("shows the engine's reason for an invalid value", async () => {
    const { engine } = engineOf({ "config.patch": { ok: false, error: "security.lockdown: Expected boolean" } });
    await mount(engine, toggle);
    await act(async () => { await view.set("yes").catch(() => undefined); });
    expect(view).toMatchObject({ state: "error", reason: "security.lockdown: Expected boolean" });
  });

  it("reads and saves a person's pref, and says why when there is no person", async () => {
    const row: Row = { id: "general.conversation.send", page: "general", card: "The conversation", level: 1, control: "segmented", source: { kind: "pref", key: "conversation.sendWith" }, fallback: "enter" };
    const { engine, request } = engineOf({ "users.prefs.get": { status: "ok", entries: { "conversation.sendWith": "ctrl" } } });
    await mount(engine, row);
    expect(view).toMatchObject({ value: "ctrl", state: "ready" });
    await act(async () => { await view.set("enter"); });
    expect(request).toHaveBeenCalledWith("users.prefs.set", { entries: { "conversation.sendWith": "enter" } });
    expect(view.value).toBe("enter");

    const none = engineOf({ "users.prefs.get": { status: "no_durable_identity" } });
    await mount(none.engine, row);
    expect(view).toMatchObject({ value: "enter", state: "error", reason: NO_PERSON });
  });

  it("puts a refused pref back", async () => {
    const row: Row = { id: "general.conversation.vim", page: "general", card: "The conversation", level: 1, control: "toggle", source: { kind: "pref", key: "conversation.vimKeys" }, fallback: false };
    const { engine } = engineOf({ "users.prefs.set": { status: "conflict" } });
    await mount(engine, row);
    await act(async () => { await view.set(true).catch(() => undefined); });
    expect(view).toMatchObject({ value: false, state: "error", reason: "It changed on another device. Try again." });
  });

  it("draws a Coming row as Coming with the call it waits for, and never saves it", async () => {
    const row: Row = { id: "general.x.soon", page: "general", card: "Writing", level: 0, control: "toggle", source: { kind: "coming", need: "clipboard.history.list", reason: "Clipboard history comes in a later update." } };
    const { engine, request } = engineOf();
    await mount(engine, row);
    expect(view).toMatchObject({ state: "coming", need: "clipboard.history.list", reason: "Clipboard history comes in a later update." });
    await act(async () => { await view.set(true).catch(() => undefined); });
    expect(view.state).toBe("coming");
    expect(request).not.toHaveBeenCalledWith("config.patch", expect.anything());
    expect(request).not.toHaveBeenCalledWith("users.prefs.set", expect.anything());
  });

  it("blocks a change this connection's scopes can't make, says why, and never sends it", async () => {
    const pref: Row = { id: "general.conversation.send", page: "general", card: "The conversation", level: 1, control: "segmented", source: { kind: "pref", key: "conversation.sendWith" }, fallback: "enter" };
    const read = engineOf({ "config.get": { hash: "h1", valid: true, config: { security: { lockdown: true } } } }, ["operator.read"]);
    await mount(read.engine, toggle);
    expect(view).toMatchObject({ value: true, state: "blocked", reason: NEEDS_ADMIN });
    await act(async () => { await expect(view.set(false)).rejects.toThrow(NEEDS_ADMIN); });
    await mount(read.engine, pref);
    expect(view).toMatchObject({ value: "enter", state: "blocked", reason: NEEDS_WRITE });
    await act(async () => { await expect(view.set("ctrl")).rejects.toThrow(NEEDS_WRITE); });
    expect(read.request).not.toHaveBeenCalledWith("config.patch", expect.anything());
    expect(read.request).not.toHaveBeenCalledWith("users.prefs.set", expect.anything());

    const write = engineOf({}, ["operator.read", "operator.write"]);
    await mount(write.engine, pref);
    expect(view.state).toBe("ready");
    await mount(write.engine, toggle);
    expect(view).toMatchObject({ state: "blocked", reason: NEEDS_ADMIN });
  });

  it("blocks config changes while the settings file is invalid, and never sends them", async () => {
    const { engine, request } = engineOf({ "config.get": { hash: "h1", valid: false, config: { security: { lockdown: true } }, issues: [{ path: "x", message: "bad" }] } });
    await mount(engine, toggle);
    expect(view).toMatchObject({ value: true, state: "blocked", reason: INVALID_CONFIG });
    await act(async () => { await expect(view.set(false)).rejects.toThrow(INVALID_CONFIG); });
    expect(request).not.toHaveBeenCalledWith("config.patch", expect.anything());
  });

  it("reads a pref again after a failed load, when the row shows again or on Try again", async () => {
    const row: Row = { id: "general.conversation.send", page: "general", card: "The conversation", level: 1, control: "segmented", source: { kind: "pref", key: "conversation.sendWith" }, fallback: "enter" };
    const flaky = () => { let calls = 0; return () => (++calls === 1 ? new Error("socket closed") : { status: "ok", entries: { "conversation.sendWith": "ctrl" } }); };
    const first = engineOf({ "users.prefs.get": flaky() });
    await mount(first.engine, row);
    expect(view).toMatchObject({ state: "error", reason: LOAD_FAILED });
    await act(async () => root.render(null));
    await mount(first.engine, row);
    expect(view).toMatchObject({ state: "ready", value: "ctrl" });

    const second = engineOf({ "users.prefs.get": flaky() });
    await mount(second.engine, row);
    expect(view.state).toBe("error");
    await act(async () => { await view.retry(); });
    expect(view).toMatchObject({ state: "ready", value: "ctrl" });
  });

  it("clears Changed somewhere else once Reload reads the settings again", async () => {
    let refuse = true;
    const { engine } = engineOf({ "config.patch": () => (refuse ? new Error("config changed since last load; re-run config.get") : { ok: true }) });
    await mount(engine, toggle);
    await act(async () => { await view.set(true).catch(() => undefined); });
    expect(view).toMatchObject({ state: "error", reason: CHANGED_ELSEWHERE });
    refuse = false;
    await act(async () => { await view.retry(); });
    expect(view.state).toBe("ready");
    expect(view.reason).toBeUndefined();
  });

  it("keeps a device key such as text size on this device", async () => {
    const row: Row = { id: "appearance.reading.size", page: "appearance", card: "Reading", level: 0, control: "select", source: { kind: "look", key: "size" } };
    const { engine, request } = engineOf();
    await mount(engine, row);
    await act(async () => { await view.set("large"); });
    expect(view).toMatchObject({ value: "large", state: "ready" });
    expect(request).not.toHaveBeenCalledWith("users.prefs.set", expect.anything());
  });
});
