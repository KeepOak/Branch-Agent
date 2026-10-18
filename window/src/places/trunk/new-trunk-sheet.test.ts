import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { canCreateTrunk, createShapedTrunk, newTrunkReadyLine, OPEN_NEW_TRUNK_SHEET, openNewTrunkSheet, startingLook, TRUNK_COLOURS, TRUNK_SHAPES, type NewTrunkDraft } from "./new-trunk-sheet";

function engineWith(result: unknown | ((method: string) => unknown)): { engine: WindowEngine; request: ReturnType<typeof vi.fn> } {
  const reply = typeof result === "function" ? result : (_method: string) => result;
  const request = vi.fn(async (method: string) => reply(method));
  return { request, engine: { request, onEvent: () => () => undefined, sessionKey: null, scopes: [] } as unknown as WindowEngine };
}

const fern: NewTrunkDraft = { name: "  Fern  ", colour: "#B84A6B", shape: "Leaf" };

describe("New Trunk sheet", () => {
  it("starts on the next palette colour and a circle", () => {
    expect(startingLook(0)).toEqual({ colour: "#2F8C86", shape: "Circle" });
    expect(startingLook(1)).toEqual({ colour: "#1785AF", shape: "Circle" });
    expect(startingLook(TRUNK_COLOURS.length)).toEqual({ colour: "#2F8C86", shape: "Circle" });
    expect(startingLook(-3).shape).toBe("Circle");
    expect(TRUNK_SHAPES).toEqual(["Circle", "Stone", "Leaf", "Acorn", "Shield"]);
  });

  it("keeps Create off until the name has something other than spaces", () => {
    expect(canCreateTrunk("")).toBe(false);
    expect(canCreateTrunk("   ")).toBe(false);
    expect(canCreateTrunk(" Fern ")).toBe(true);
  });

  it("tells the person the Trunk is ready and where the rest lives", () => {
    const line = newTrunkReadyLine("Fern");
    expect(line).toBe("All set. I’m “Fern” for now. Change the model, instructions and tools from the Trunk’s details or Settings. What’s the first job?");
    expect(line).not.toContain("—");
  });

  it("opens the same sheet from Find anything and Settings search", () => {
    const heard = vi.fn();
    window.addEventListener(OPEN_NEW_TRUNK_SHEET, heard);
    openNewTrunkSheet();
    expect(heard).toHaveBeenCalledOnce();
    window.removeEventListener(OPEN_NEW_TRUNK_SHEET, heard);
  });

  it("creates the pebble the sheet shows, with round eyes", async () => {
    const { engine, request } = engineWith({ agentId: "fern" });
    await expect(createShapedTrunk(engine, { name: "  Fern  ", colour: "#B84A6B", shape: "Leaf" })).resolves.toBe("fern");
    expect(request).toHaveBeenCalledWith("agents.create", {
      name: "Fern",
      avatar: "classic",
      colour: "#B84A6B",
      shape: "Leaf",
      eyes: "Round",
    });
  });

  it("refuses a blank name before it asks the engine", async () => {
    const { engine, request } = engineWith({ agentId: "fern" });
    await expect(createShapedTrunk(engine, { name: "  ", colour: "#2F8C86", shape: "Circle" })).rejects.toThrow("Give the Trunk a name.");
    expect(request).not.toHaveBeenCalled();
  });

  it("surfaces the engine’s refusal", async () => {
    const { engine } = engineWith({ ok: false, error: "name already exists" });
    await expect(createShapedTrunk(engine, { name: "Fern", colour: "#2F8C86", shape: "Circle" })).rejects.toThrow("name already exists");
  });

  it("opens the existing Trunk when Create is pressed again after it already exists", async () => {
    let created = false;
    const { engine, request } = engineWith((method: string) => {
      if (method === "agents.create") {
        if (created) return { ok: false, error: { message: 'agent "fern" already exists' } };
        created = true;
        return { agentId: "fern" };
      }
      if (method === "agents.list") return { agents: [{ id: "fern", identity: { name: "Fern" } }] };
      return {};
    });
    await expect(createShapedTrunk(engine, fern)).resolves.toBe("fern");
    await expect(createShapedTrunk(engine, fern)).resolves.toBe("fern");
    expect(request.mock.calls.filter(([method]) => method === "agents.create")).toHaveLength(2);
    expect(request).toHaveBeenCalledWith("agents.list", {});
  });

  it("opens the existing Trunk when the engine throws the already-exists line", async () => {
    const { engine, request } = engineWith((method: string) => {
      if (method === "agents.create") throw new Error('agent "hazel" already exists');
      if (method === "agents.list") throw new Error("Roster temporarily unavailable");
      return {};
    });
    await expect(createShapedTrunk(engine, { name: "Hazel", colour: "#2F8C86", shape: "Circle" })).resolves.toBe("hazel");
    expect(request).toHaveBeenCalledWith("agents.list", {});
  });

  it("finds the existing Trunk by name when the refusal has no quoted id", async () => {
    const { engine } = engineWith((method: string) => {
      if (method === "agents.create") return { ok: false, error: { message: "agent already exists" } };
      if (method === "agents.list") return { agents: [{ id: "fern", identity: { name: "Fern" } }] };
      return {};
    });
    await expect(createShapedTrunk(engine, { name: "Fern", colour: "#2F8C86", shape: "Circle" })).resolves.toBe("fern");
  });

  it("still throws a real create failure", async () => {
    const { engine, request } = engineWith({ ok: false, error: { message: "Permission denied" } });
    await expect(createShapedTrunk(engine, { name: "Fern", colour: "#2F8C86", shape: "Circle" })).rejects.toThrow("Permission denied");
    expect(request.mock.calls.map(([method]) => method)).toEqual(["agents.create"]);
  });
});
