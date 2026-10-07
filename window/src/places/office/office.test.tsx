import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { parseRoute } from "../../places-nav/routes";
import { readLayout, readOfficeStore, writeLayout, writeOfficeSetting } from "./index";
import { a2aVisit, officeRoster, officeToolEvent } from "./model";
import { Storage, defaultPrefs } from "./pixel/webview-ui/src/branch/storage";
import { defaultSpriteKey } from "./pixel/webview-ui/src/branch/trunkSprites";

describe("Pixel office", () => {
  it("uses each Trunk's preview look for its desk sprite", () => {
    const { agents } = officeRoster({ agents: [
      { id: "branch", identity: { name: "Branch Agent", avatar: "branch:ember", colour: "#B84A6B" } },
      { id: "c3po", identity: { name: "C3-PO", avatar: "branch:bolt", colour: "#D4A017" } },
      { id: "classic", identity: { name: "Classic", avatar: "classic", colour: "#2F8C86", shape: "Leaf", eyes: "Wide" } },
      { id: "emoji1", identity: { name: "Emoji One", avatar: "classic", emoji: "🦊", colour: "#B84A6B" } },
      { id: "emoji2", identity: { name: "Emoji Two", avatar: "classic", emoji: "🦉", colour: "#B84A6B" } },
      { id: "colorless", identity: { name: "Colorless", avatar: "classic", colour: "", shape: "Circle", eyes: "Round" } },
    ] }, {}, {});
    const keys = agents.map(defaultSpriteKey);
    expect(keys[0]).toBe("look:ember");
    expect(keys[1]).toBe("look:bolt");
    expect(keys[2]).toBe("pebble:2:wide:#2F8C86");
    expect(keys[3]).toMatch(/^pebble:\d+:(round|wide|sleepy):#[0-9A-F]{6}$/);
    expect(keys[4]).toMatch(/^pebble:\d+:(round|wide|sleepy):#[0-9A-F]{6}$/);
    expect(keys[5]).toBe("pebble:0:round:#56616B");
    expect(keys[3]).not.toBe(keys[4]);
    expect(keys[3]).not.toBe(keys[5]);
    expect(keys[4]).not.toBe(keys[5]);
  });

  it("emoji and colourless Trunks get distinct sprites, not identical pebbles", () => {
    const { agents } = officeRoster({ agents: [
      { id: "fox", identity: { name: "Fox", avatar: "classic", emoji: "🦊", colour: "" } },
      { id: "owl", identity: { name: "Owl", avatar: "classic", emoji: "🦉", colour: "" } },
      { id: "grey", identity: { name: "Grey", avatar: "classic", colour: "", shape: "Circle", eyes: "Round" } },
    ] }, {}, {});
    const keys = agents.map(defaultSpriteKey);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).not.toBe(keys[2]);
    expect(keys[1]).not.toBe(keys[2]);
    expect(keys).toEqual(expect.arrayContaining([
      expect.stringMatching(/^pebble:\d+:(round|wide|sleepy):#[0-9A-F]{6}$/),
      expect.stringMatching(/^pebble:\d+:(round|wide|sleepy):#[0-9A-F]{6}$/),
      "pebble:0:round:#56616B",
    ]));
  });

  it("seats the live Trunk roster, guests, and groups with registry states and real chat targets", () => {
    const model = officeRoster(
      { mainKey: "main", agents: [{ id: "oak", identity: { name: "Oak", colour: "#647c55" } }, { id: "elm", identity: { name: "Elm" } }] },
      { sessions: [{ key: "agent:oak:work", agentId: "oak", hasActiveRun: true, activeRunIds: ["r1"] }, { key: "agent:oak:child", agentId: "oak", hasActiveRun: true, spawnedBy: "agent:oak:work", label: "Research" }] },
      { contacts: [
        { id: "trunk:oak", kind: "trunk", name: "Oak", threadKey: "agent:oak:main", face: { agentId: "oak" }, needsYou: true },
        { id: "a2a:guest", kind: "outside", name: "Guest", threadKey: "a2a:guest:main", working: true },
        { id: "group:team", kind: "group", name: "Team", threadKey: "group:team:main", face: { members: ["oak", "elm"] } },
      ] },
    );
    expect(model.agents.map(a => [a.id, a.kind, a.state])).toEqual([
      ["oak", "trunk", "needs_you"], ["elm", "trunk", "resting"], ["a2a:guest", "grafted", "working"], ["group:team", "group", "resting"],
    ]);
    expect(model.agents[0]?.subagents).toEqual([{ id: "agent:oak:child", label: "Research", state: "working" }]);
    expect(model.openKey.get("oak")).toBe("agent:oak:main");
    expect(model.openKey.get("group:team")).toBe("group:team:main");
    expect(officeRoster({ agents: [] }, {}, { contacts: [{ id: "a2a:guest", kind: "outside", name: "Guest", threadKey: "a2a:guest:main" }] }, { agents: [{ contactId: "a2a:guest", online: false }] }).agents[0]?.state).toBe("offline");
  });

  it("saves an edited layout in engine profile preferences and restores it after reload", async () => {
    const entries: Record<string, unknown> = {};
    const request = vi.fn(async (method: string, params: unknown) => {
      const p = params as { keys?: string[]; entries?: Record<string, unknown> };
      if (method === "users.prefs.get") return { status: "ok", entries: Object.fromEntries((p.keys ?? []).map(k => [k, entries[k]])) };
      if (method === "users.prefs.set") { Object.assign(entries, p.entries); return { status: "ok" }; }
      throw new Error(method);
    });
    const engine = { request } as unknown as WindowEngine;
    const layout = { version: 1, tiles: Array.from({ length: 4096 }, (_, n) => n % 9), furniture: [{ id: "desk", x: 9, y: 8 }] };
    expect(await writeLayout(engine, layout, 0)).toBeGreaterThan(0);
    expect(await readLayout(engine)).toEqual({ layout, count: (entries["ui.pixelOffice.layout.meta"] as { parts: number }).parts });
    expect(request).toHaveBeenCalledWith("users.prefs.set", expect.objectContaining({ entries: expect.objectContaining({ "ui.pixelOffice.layout.meta": expect.any(Object) }) }));
    await writeOfficeSetting(engine, "seats", { oak: "desk-2" });
    await writeOfficeSetting(engine, "looks", { oak: { spriteKey: "ember" } });
    await writeOfficeSetting(engine, "prefs", { soundEnabled: false });
    expect((await readOfficeStore(engine)).store).toMatchObject({ layout, seats: { oak: "desk-2" }, looks: { oak: { spriteKey: "ember" } }, prefs: { soundEnabled: false } });
  });

  it("passes every office store mutation to the host without using localStorage", () => {
    const local = vi.spyOn(window.localStorage, "setItem");
    const save = vi.fn();
    const store = new Storage({ layout: null, seats: {}, looks: {}, prefs: defaultPrefs() }, save);
    store.saveLayout(null);
    store.saveSeats({ oak: "desk-2" });
    store.saveLooks({ oak: { spriteKey: "ember" } });
    store.savePrefs({ ...defaultPrefs(), soundEnabled: false });
    expect(save.mock.calls.map(([key]) => key)).toEqual(["layout", "seats", "looks", "prefs"]);
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });

  it("shows profile read errors instead of silently disabling saving", async () => {
    const engine = { request: vi.fn(async () => ({ status: "error" })) } as unknown as WindowEngine;
    await expect(readLayout(engine)).rejects.toThrow("couldn't load");
    await expect(readOfficeStore(engine)).rejects.toThrow("couldn't load");
  });

  it("reads working and reading from live run and tool events, not nonexistent session row fields", () => {
    const agents = { agents: [{ id: "oak", identity: { name: "Oak" } }] };
    const sessions = { sessions: [{ key: "agent:oak:main", agentId: "oak", hasActiveRun: true, activeRunIds: ["r1"] }] };
    const contacts = { contacts: [{ id: "trunk:oak", kind: "trunk", name: "Oak", threadKey: "agent:oak:main", needsYou: false }] };
    const state = (tools?: ReturnType<typeof officeToolEvent>) => officeRoster(agents, sessions, contacts, {}, tools).agents[0]?.state;
    expect(state()).toBe("working");
    const reading = officeToolEvent(new Map(), "session.tool", { runId: "r1", stream: "tool", sessionKey: "agent:oak:main", data: { phase: "start", name: "read_file", toolCallId: "t1" } });
    expect(state(reading)).toBe("reading");
    const done = officeToolEvent(reading, "session.tool", { runId: "r1", stream: "tool", sessionKey: "agent:oak:main", data: { phase: "result", name: "read_file", toolCallId: "t1" } });
    expect(state(done)).toBe("working");
    expect(officeRoster(agents, sessions, { contacts: [{ ...contacts.contacts[0], needsYou: true }] }, {}, done).agents[0]?.state).toBe("needs_you");
    expect(officeRoster(agents, { sessions: [{ ...sessions.sessions[0], hasActiveRun: false, activeRunIds: [] }] }, contacts).agents[0]?.state).toBe("resting");
  });

  it("shows a needs-you bubble for pending approvals even while the Trunk is working", () => {
    const agents = { agents: [{ id: "oak", identity: { name: "Oak" } }] };
    const sessions = { sessions: [{ key: "agent:oak:main", agentId: "oak", hasActiveRun: true }] };
    const contacts = { contacts: [{ id: "trunk:oak", kind: "trunk", name: "Oak", threadKey: "agent:oak:main", needsYou: false }] };
    const approval = { id: "approval-1", request: { sessionKey: "agent:oak:main" } };
    const roster = officeRoster(agents, sessions, contacts, {}, new Map(), { items: [approval] });
    expect(roster.agents[0]).toMatchObject({ state: "needs_you", needsYou: 1 });
    const helper = { ...approval, request: { sessionKey: "agent:oak:child" } };
    const withHelper = officeRoster(agents, { sessions: [...sessions.sessions, { key: "agent:oak:child", agentId: "oak", hasActiveRun: true, spawnedBy: "agent:oak:main" }] }, { contacts: [{ ...contacts.contacts[0], needsYou: true }] }, {}, new Map(), [[], [helper], []]);
    expect(withHelper.agents[0]).toMatchObject({ state: "working", needsYou: 1 });
    expect(officeRoster(agents, sessions, contacts, {}, new Map(), { items: [{ ...approval, state: "allowed" }] }).agents[0]?.state).toBe("working");
  });

  it("keeps the office as a main-pane route for back and forward history", () => {
    expect(parseRoute('{"kind":"place","place":"office"}')).toEqual({ kind: "place", place: "office" });
  });

  it("animates only a real A2A speaker visiting the addressed Trunk", () => {
    expect(a2aVisit({ agentId: "oak", message: { sender: { id: "guest", identity: { pluginId: "a2a" } } } }, 123)).toEqual({ from: "a2a:guest", to: "oak", at: 123 });
    expect(a2aVisit({ agentId: "oak", message: { sender: { id: "owner" } } }, 123)).toBeNull();
  });
});
