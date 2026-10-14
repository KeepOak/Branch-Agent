// R1's + › New Trunk and the Grove's Trunk button make a random Trunk: one create call, no dialog, its conversation opened.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { makeRandomTrunk } from "./new-trunk-r1";

const created: { name: string; avatar?: string }[] = [];
vi.mock("./api", () => ({
  createTrunk: vi.fn(async (_engine: unknown, name: string, avatar?: string) => { created.push({ name, avatar }); return "ash"; }),
  waitForTrunk: vi.fn(async () => undefined),
}));

function engineWith(agents: { id: string; name: string }[]): WindowEngine {
  return { request: vi.fn(async (method: string) => (method === "agents.list" ? { defaultId: "main", mainKey: "main", agents } : {})) } as unknown as WindowEngine;
}

beforeEach(() => { created.length = 0; });

describe("makeRandomTrunk", () => {
  it("makes one Trunk with a random unused name and look, then opens its conversation", async () => {
    const open = vi.fn(async (agentId: string) => `agent:${agentId}:main`);
    const flow = await makeRandomTrunk(engineWith([{ id: "main", name: "Sapling" }]), open);
    expect(created).toHaveLength(1);
    expect(created[0].name).not.toBe("Sapling");
    expect(created[0].name.length).toBeGreaterThan(0);
    expect(created[0].avatar).toMatch(/^branch:/);
    expect(open).toHaveBeenCalledWith("ash");
    expect(flow).toEqual({ agentId: "ash", sessionKey: "agent:ash:main", name: created[0].name });
  });

  it("makes no conversation and returns null when the conversation cannot open", async () => {
    const flow = await makeRandomTrunk(engineWith([]), async () => null);
    expect(created).toHaveLength(1);
    expect(flow).toBeNull();
  });
});
