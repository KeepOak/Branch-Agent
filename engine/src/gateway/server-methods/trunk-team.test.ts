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

const { trunkTeamHandlers } = await import("./trunk-team.js");

function context(connected: string[] = []) {
  return {
    getRuntimeConfig: () => mocks.cfg,
    nodeRegistry: { listConnected: () => connected.map((nodeId) => ({ nodeId })) },
    logGateway: { warn: vi.fn() },
  } as never;
}

async function call(
  method: "trunks.team.propose" | "trunks.team.approve",
  params: object,
  connected: string[] = [],
) {
  const respond = vi.fn();
  await trunkTeamHandlers[method]!({ params, respond, context: context(connected) } as never);
  return respond;
}

async function proposalHash(goal: string, connected: string[] = []): Promise<string> {
  const respond = await call("trunks.team.propose", { goal }, connected);
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

describe("placement on create", () => {
  it("binds a remote computer into the Trunk's config, and leaves this computer as the default", async () => {
    const hash = await proposalHash(goal, ["node-a"]);
    mocks.approval.mockResolvedValue("allow");

    await call("trunks.team.approve", { goal, proposalHash: hash }, ["node-a"]);

    const byId = Object.fromEntries(
      mocks.createAgent.mock.calls.map(([params]) => [params.entry.id, params.entry]),
    );
    const remote = Object.values(byId).filter((entry) => entry.tools?.exec?.node === "node-a");
    expect(remote).toHaveLength(1);
    expect(remote[0]?.tools?.exec).toEqual({ host: "node", node: "node-a" });
    const local = Object.values(byId).filter((entry) => entry.tools === undefined);
    expect(local).toHaveLength(2);
  });
});

describe("concurrent approvals", () => {
  it("runs a different proposal for the same team on its own, without its answer", async () => {
    const hashAlone = await proposalHash(goal, []);
    const hashPaired = await proposalHash(goal, ["node-a"]);
    expect(hashPaired).not.toBe(hashAlone);
    mocks.approval.mockResolvedValue("allow");

    const [alone, paired] = await Promise.all([
      call("trunks.team.approve", { goal, proposalHash: hashAlone }, []),
      call("trunks.team.approve", { goal, proposalHash: hashPaired }, ["node-a"]),
    ]);

    expect(mocks.approval).toHaveBeenCalledTimes(2);
    expect(alone.mock.calls[0]?.[1]).toMatchObject({ status: "applied" });
    expect(paired.mock.calls[0]?.[1]).toMatchObject({ status: "applied" });
    const remote = mocks.createAgent.mock.calls.filter(([params]) => params.entry.tools !== undefined);
    expect(remote.length).toBeGreaterThan(0);
  });
  it("creates each Trunk once when the same team is approved twice at the same time", async () => {
    const hash = await proposalHash(goal);
    let release: (value: string) => void = () => undefined;
    mocks.approval.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );

    const first = call("trunks.team.approve", { goal, proposalHash: hash });
    const second = call("trunks.team.approve", { goal, proposalHash: hash });
    await vi.waitFor(() => expect(mocks.approval).toHaveBeenCalled());
    release("allow");
    const [firstRespond, secondRespond] = await Promise.all([first, second]);

    expect(mocks.approval).toHaveBeenCalledTimes(1);
    expect(mocks.createAgent).toHaveBeenCalledTimes(3);
    expect(mocks.rooms.size).toBe(1);
    expect(mocks.queue).toHaveLength(3);
    expect(firstRespond.mock.calls[0]?.[1]).toMatchObject({ status: "applied" });
    expect(secondRespond.mock.calls[0]?.[1]).toMatchObject({ status: "applied" });
  });
});

describe("retry after a partial failure", () => {
  it("finishes the team on the next approve without creating a Trunk twice", async () => {
    const hash = await proposalHash(goal);
    mocks.approval.mockResolvedValue("allow");
    let failNext = true;
    mocks.createAgent.mockImplementation(async (params: { entry: { id: string } }) => {
      if (failNext) {
        failNext = false;
        throw new Error("gateway busy");
      }
      mocks.cfg.agents!.entries![params.entry.id] = {};
      return { status: "created", agentId: params.entry.id, name: "x" };
    });

    const failed = await call("trunks.team.approve", { goal, proposalHash: hash });
    expect(failed.mock.calls[0]?.[0]).toBe(false);
    expect(mocks.rooms.size).toBe(0);
    expect(mocks.queue).toHaveLength(0);

    const retried = await call("trunks.team.approve", { goal, proposalHash: hash });

    expect(retried.mock.calls[0]?.[1]).toMatchObject({ status: "applied" });
    expect(mocks.createAgent).toHaveBeenCalledTimes(4);
    expect(new Set(Object.keys(mocks.cfg.agents!.entries!)).size).toBe(4);
    expect(mocks.rooms.size).toBe(1);
    expect(mocks.queue).toHaveLength(3);
  });
});
