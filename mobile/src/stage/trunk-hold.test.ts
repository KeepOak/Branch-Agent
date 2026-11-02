import { holdTrunk, releaseTrunk } from "./trunk-hold";
import type { EngineLink } from "../pairing/pairingSession";

function linkFor(goal: { id: string; status: string } | null): EngineLink & { ops: Array<Record<string, unknown>> } {
  const ops: Array<Record<string, unknown>> = [];
  const link: EngineLink & { ops: Array<Record<string, unknown>> } = {
    ops,
    hello: null,
    onEvent: () => () => undefined,
    onConnected: () => () => undefined,
    request: async (method, params) => {
      if (method === "sessions.describe") {
        return { session: { key: "agent:oak:main", agentId: "oak", ...(goal ? { goal } : {}) } } as never;
      }
      if (method === "sessions.goal.update") {
        ops.push(params as Record<string, unknown>);
        return { ok: true } as never;
      }
      return {} as never;
    },
  };
  return link;
}

describe("holdTrunk", () => {
  it("pauses an active Goal and resumes only that hold", async () => {
    const link = linkFor({ id: "goal-1", status: "active" });
    const hold = await holdTrunk(link, "agent:oak:main");
    expect(hold).toEqual({ sessionKey: "agent:oak:main", goalId: "goal-1", agentId: "oak" });
    expect(link.ops[0]).toMatchObject({
      sessionKey: "agent:oak:main",
      agentId: "oak",
      goalId: "goal-1",
      action: "pause",
      note: "You took over its browser or computer.",
    });
    await releaseTrunk(link, hold!);
    expect(link.ops[1]).toMatchObject({ action: "resume", goalId: "goal-1" });
  });

  it("does not claim a pause when there is no Goal, and never resumes a Goal it didn't pause", async () => {
    expect(await holdTrunk(linkFor(null), "agent:oak:main")).toBeNull();
    expect(await holdTrunk(linkFor({ id: "goal-1", status: "paused" }), "agent:oak:main")).toBeNull();
    expect(await holdTrunk(linkFor({ id: "goal-1", status: "active" }), null)).toBeNull();
  });
});
