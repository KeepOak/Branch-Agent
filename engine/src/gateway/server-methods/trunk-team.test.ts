import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";

const mocks = vi.hoisted(() => ({
  approval: vi.fn(),
  createAgent: vi.fn(),
  rooms: new Map<string, unknown>(),
  queue: [] as Array<{ title: string; brief_text: string }>,
  cfg: {} as BranchConfig,
}));

vi.mock("./model-choice-approval.js", () => ({
  requestOwnerChangeApproval: mocks.approval,
}));
vi.mock("../../agents/agent-create.js", () => ({ createAgent: mocks.createAgent }));
vi.mock("../rooms/store.js", () => ({
  getRoom: (roomId: string) => mocks.rooms.get(roomId),
  createRoom: (input: { roomId: string }) => {
    mocks.rooms.set(input.roomId, input);
    return input;
  },
}));
vi.mock("../../agents/trunk-queue.js", () => ({
  addQueueItem: (input: { title: string; brief_text: string }) => {
    mocks.queue.push(input);
    return input;
  },
  listQueueItems: () => mocks.queue,
}));
vi.mock("./trunk-queue.js", () => ({ wakeEligibleTrunks: vi.fn() }));
vi.mock("../../agents/trunk-team-registry.js", () => ({ registerTeam: vi.fn() }));

const { trunkTeamHandlers } = await import("./trunk-team.js");

function context() {
  return {
    getRuntimeConfig: () => mocks.cfg,
    nodeRegistry: { listConnected: () => [] },
    logGateway: { warn: vi.fn() },
  } as never;
}

async function call(method: "trunks.team.propose" | "trunks.team.approve", params: object) {
  const respond = vi.fn();
  await trunkTeamHandlers[method]!({ params, respond, context: context() } as never);
  return respond;
}

async function proposalHash(goal: string): Promise<string> {
  const respond = await call("trunks.team.propose", { goal });
  const payload = respond.mock.calls[0]?.[1] as { proposal: { hash: string } };
  return payload.proposal.hash;
}

beforeEach(() => {
  mocks.rooms.clear();
  mocks.queue.length = 0;
  mocks.createAgent.mockReset();
  mocks.approval.mockReset();
  mocks.cfg = {
    agents: {
      defaults: { model: "anthropic/claude-sonnet" },
      entries: { main: {} },
    },
  };
  mocks.createAgent.mockImplementation(async (params: { entry: { id: string; name: string } }) => {
    mocks.cfg.agents!.entries![params.entry.id] = {};
    return { status: "created", agentId: params.entry.id, name: params.entry.name };
  });
});

const goal = "Ship the Q3 newsletter";

describe("trunks.team.propose", () => {
  it("only proposes: nothing is created and nothing is asked", async () => {
    const respond = await call("trunks.team.propose", { goal });

    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(respond.mock.calls[0]?.[1]).toMatchObject({ proposal: expect.anything() });
    expect(mocks.approval).not.toHaveBeenCalled();
    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.rooms.size).toBe(0);
    expect(mocks.queue).toHaveLength(0);
  });
});

describe("trunks.team.approve", () => {
  it("refuses a proposal whose team changed since it was shown, and asks nothing", async () => {
    const hash = await proposalHash(goal);
    mocks.cfg.agents!.defaults = { model: "openai/gpt" };

    const respond = await call("trunks.team.approve", { goal, proposalHash: hash });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(mocks.approval).not.toHaveBeenCalled();
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });

  it("creates nothing when the owner declines the card", async () => {
    const hash = await proposalHash(goal);
    mocks.approval.mockResolvedValue("deny");

    const respond = await call("trunks.team.approve", { goal, proposalHash: hash });

    expect(respond.mock.calls[0]).toEqual([true, { status: "declined" }]);
    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.rooms.size).toBe(0);
    expect(mocks.queue).toHaveLength(0);
  });

  it("creates nothing when no approval surface is available", async () => {
    const hash = await proposalHash(goal);
    mocks.approval.mockResolvedValue("unavailable");

    const respond = await call("trunks.team.approve", { goal, proposalHash: hash });

    expect(respond.mock.calls[0]).toEqual([true, { status: "unavailable" }]);
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });

  it("applies an allowed team once: three Trunks, one room, three jobs", async () => {
    const hash = await proposalHash(goal);
    mocks.approval.mockResolvedValue("allow");

    const respond = await call("trunks.team.approve", { goal, proposalHash: hash });

    expect(respond.mock.calls[0]?.[1]).toMatchObject({ status: "applied" });
    expect(mocks.createAgent).toHaveBeenCalledTimes(3);
    for (const [params] of mocks.createAgent.mock.calls) {
      expect(params).toMatchObject({ skipBootstrap: true, model: "anthropic/claude-sonnet" });
    }
    const ids = mocks.createAgent.mock.calls.map(([params]) => params.entry.id);
    expect(ids).toEqual(expect.arrayContaining([expect.stringMatching(/^builder-scout-/)]));
    expect(mocks.rooms.size).toBe(1);
    expect(mocks.queue).toHaveLength(3);
  });

  it("does not repeat anything when the same team is approved again", async () => {
    const hash = await proposalHash(goal);
    mocks.approval.mockResolvedValue("allow");
    await call("trunks.team.approve", { goal, proposalHash: hash });

    const again = await call("trunks.team.approve", { goal, proposalHash: hash });

    expect(again.mock.calls[0]?.[1]).toMatchObject({ status: "applied", created: [] });
    expect(mocks.createAgent).toHaveBeenCalledTimes(3);
    expect(mocks.rooms.size).toBe(1);
    expect(mocks.queue).toHaveLength(3);
  });
});
