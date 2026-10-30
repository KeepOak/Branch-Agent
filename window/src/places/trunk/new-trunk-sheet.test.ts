import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { creationProblem } from "./model";
import { canCreateTrunk, createShapedTrunk, newTrunkReadyLine, OPEN_NEW_TRUNK_SHEET, openNewTrunkSheet, startingLook, TRUNK_COLOURS, TRUNK_SHAPES, type NewTrunkDraft } from "./new-trunk-sheet";

let gatewaySeq = 0;

function engineWith(
  result: unknown | ((method: string) => unknown),
  gatewayUrl = `ws://gateway-${(gatewaySeq += 1)}.test`,
): { engine: WindowEngine; request: ReturnType<typeof vi.fn> } {
  const reply = typeof result === "function" ? result : (_method: string) => result;
  const request = vi.fn(async (method: string) => reply(method));
  return { request, engine: { request, onEvent: () => () => undefined, sessionKey: null, scopes: [], gatewayUrl } as unknown as WindowEngine };
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

  it("opens the Trunk when the first reply was lost and Create again says it already exists", async () => {
    let calls = 0;
    const { engine, request } = engineWith((method: string) => {
      if (method === "agents.create") {
        calls += 1;
        if (calls === 1) throw new Error("Connection closed before the reply arrived");
        return { ok: false, error: { message: 'agent "fern" already exists' } };
      }
      if (method === "agents.list") return { agents: [{ id: "fern", identity: { name: "Fern" } }] };
      return {};
    });
    await expect(createShapedTrunk(engine, fern)).rejects.toThrow("Connection closed before the reply arrived");
    await expect(createShapedTrunk(engine, fern)).resolves.toBe("fern");
    expect(request.mock.calls.filter(([method]) => method === "agents.create")).toHaveLength(2);
  });

  it("asks for another name when the engine throws the already-exists line for an older Trunk", async () => {
    const { engine, request } = engineWith((method: string) => {
      if (method === "agents.create") throw new Error('agent "hazel" already exists');
      if (method === "agents.list") return { agents: [{ id: "hazel", identity: { name: "Hazel" } }] };
      return {};
    });
    const error = await createShapedTrunk(engine, { name: "Hazel", colour: "#2F8C86", shape: "Circle" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('agent "hazel" already exists');
    expect(creationProblem(error)).toBe("That Trunk name is already taken. Choose another name.");
    expect(request).not.toHaveBeenCalledWith("agents.list", {});
  });

  it("asks for another name when an older Trunk has the name and the refusal has no quoted id", async () => {
    const { engine } = engineWith((method: string) => {
      if (method === "agents.create") return { ok: false, error: { message: "agent already exists" } };
      if (method === "agents.list") return { agents: [{ id: "fern", identity: { name: "Fern" } }] };
      return {};
    });
    const error = await createShapedTrunk(engine, { name: "Fern", colour: "#2F8C86", shape: "Circle" }).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("agent already exists");
    expect(creationProblem(error)).toBe("That Trunk name is already taken. Choose another name.");
  });

  it("keeps asking for another name when an older Trunk's name is submitted again (thrown refusal)", async () => {
    const { engine, request } = engineWith((method: string) => {
      if (method === "agents.create") throw new Error('agent "hazel" already exists');
      if (method === "agents.list") return { agents: [{ id: "hazel", identity: { name: "Hazel" } }] };
      return {};
    });
    await expect(createShapedTrunk(engine, { name: "Hazel", colour: "#2F8C86", shape: "Circle" })).rejects.toThrow('agent "hazel" already exists');
    await expect(createShapedTrunk(engine, { name: "  hazel ", colour: "#2F8C86", shape: "Circle" })).rejects.toThrow('agent "hazel" already exists');
    expect(request.mock.calls.filter(([method]) => method === "agents.create")).toHaveLength(2);
    expect(request).not.toHaveBeenCalledWith("agents.list", {});
  });

  it("keeps asking for another name when an older Trunk's name is submitted again (returned refusal)", async () => {
    const { engine, request } = engineWith((method: string) => {
      if (method === "agents.create") return { ok: false, error: { message: 'agent "hazel" already exists' } };
      if (method === "agents.list") return { agents: [{ id: "hazel", identity: { name: "Hazel" } }] };
      return {};
    });
    await expect(createShapedTrunk(engine, { name: "Hazel", colour: "#2F8C86", shape: "Circle" })).rejects.toThrow('agent "hazel" already exists');
    const error = await createShapedTrunk(engine, { name: "  hazel ", colour: "#2F8C86", shape: "Circle" }).catch((caught: unknown) => caught);
    expect(creationProblem(error)).toBe("That Trunk name is already taken. Choose another name.");
    expect(request).not.toHaveBeenCalledWith("agents.list", {});
  });

  it("opens the Trunk when Create again runs on the new handle a reconnect built", async () => {
    const gatewayUrl = "ws://reconnect.test";
    const first = engineWith((method: string) => {
      if (method === "agents.create") throw new Error("Connection closed before the reply arrived");
      return {};
    }, gatewayUrl);
    await expect(createShapedTrunk(first.engine, fern)).rejects.toThrow("Connection closed before the reply arrived");
    const second = engineWith((method: string) => {
      if (method === "agents.create") return { ok: false, error: { message: 'agent "fern" already exists' } };
      if (method === "agents.list") return { agents: [{ id: "fern", identity: { name: "Fern" } }] };
      return {};
    }, gatewayUrl);
    await expect(createShapedTrunk(second.engine, fern)).resolves.toBe("fern");
    expect(second.request).toHaveBeenCalledWith("agents.list", {});
  });

  it("does not let a name tried on one gateway open silently on another", async () => {
    const first = engineWith((method: string) => {
      if (method === "agents.create") throw new Error("Connection closed before the reply arrived");
      return {};
    });
    await expect(createShapedTrunk(first.engine, fern)).rejects.toThrow("Connection closed before the reply arrived");
    const second = engineWith((method: string) => {
      if (method === "agents.create") return { ok: false, error: { message: 'agent "fern" already exists' } };
      if (method === "agents.list") return { agents: [{ id: "fern", identity: { name: "Fern" } }] };
      return {};
    });
    await expect(createShapedTrunk(second.engine, fern)).rejects.toThrow('agent "fern" already exists');
    expect(second.request).not.toHaveBeenCalledWith("agents.list", {});
  });

  it("still throws a real create failure", async () => {
    const { engine, request } = engineWith({ ok: false, error: { message: "Permission denied" } });
    await expect(createShapedTrunk(engine, { name: "Fern", colour: "#2F8C86", shape: "Circle" })).rejects.toThrow("Permission denied");
    expect(request.mock.calls.map(([method]) => method)).toEqual(["agents.create"]);
  });
});
