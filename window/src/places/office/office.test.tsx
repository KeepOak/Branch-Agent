import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { parseRoute } from "../../places-nav/routes";
import { readLayout, writeLayout } from "./index";
import { a2aVisit, officeRoster } from "./model";

describe("Pixel office", () => {
  it("seats the live Trunk roster, guests, and groups with registry states and real chat targets", () => {
    const model = officeRoster(
      { mainKey: "main", agents: [{ id: "oak", identity: { name: "Oak", colour: "#647c55" } }, { id: "elm", identity: { name: "Elm" }, paused: true }] },
      { sessions: [{ key: "agent:oak:work", agentId: "oak", hasActiveRun: true, activeRunIds: ["r1"] }, { key: "agent:oak:child", agentId: "oak", hasActiveRun: true, spawnedBy: "agent:oak:work", label: "Research" }] },
      { contacts: [
        { id: "trunk:oak", kind: "trunk", name: "Oak", threadKey: "agent:oak:main", face: { agentId: "oak" }, needsYou: true },
        { id: "a2a:guest", kind: "outside", name: "Guest", threadKey: "a2a:guest:main", working: true },
        { id: "group:team", kind: "group", name: "Team", threadKey: "group:team:main", face: { members: ["oak", "elm"] } },
      ] },
    );
    expect(model.agents.map(a => [a.id, a.kind, a.state])).toEqual([
      ["oak", "trunk", "needs_you"], ["elm", "trunk", "offline"], ["a2a:guest", "grafted", "working"], ["group:team", "group", "resting"],
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
  });

  it("keeps the office as a main-pane route for back and forward history", () => {
    expect(parseRoute('{"kind":"place","place":"office"}')).toEqual({ kind: "place", place: "office" });
  });

  it("animates only a real A2A speaker visiting the addressed Trunk", () => {
    expect(a2aVisit({ agentId: "oak", message: { sender: { id: "guest", identity: { pluginId: "a2a" } } } }, 123)).toEqual({ from: "a2a:guest", to: "oak", at: 123 });
    expect(a2aVisit({ agentId: "oak", message: { sender: { id: "owner" } } }, 123)).toBeNull();
  });
});
