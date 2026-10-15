import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";

const mocks = vi.hoisted(() => ({
  // The owner's answer on the approval record, given after `gate` opens. "unavailable" means no approval surface.
  answer: "allow" as "allow" | "deny" | "unavailable" | "expired",
  /** When set, the approval fails to register: the record is never handed out. */
  registerFails: false,
  gate: Promise.resolve() as Promise<void>,
  records: 0,
  approval: vi.fn(),
  createAgent: vi.fn(),
  rooms: new Map<string, unknown>(),
  queue: [] as Array<{ title: string; brief_text: string }>,
  cfg: {} as BranchConfig,
  connected: [] as string[],
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
vi.mock("../../agents/trunk-team-proposals.js", () => {
  const records = new Map<string, Record<string, unknown>>();
  return {
    readProposal: (hash: string) => records.get(hash),
    saveProposal: (record: { hash: string }) => {
      records.set(record.hash, { ...record, updatedAt: Date.now() });
      return records.get(record.hash);
    },
    forgetProposal: (hash: string) => {
      records.delete(hash);
    },
    proposalRecords: records,
  };
});
vi.mock("./trunk-team-progress.js", () => ({ publishTeamChange: vi.fn() }));

const { trunkTeamHandlers } = await import("./trunk-team.js");

let goal = "Ship the Q3 newsletter";
let goals = 0;
const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function context() {
  return {
    getRuntimeConfig: () => mocks.cfg,
    nodeRegistry: { listConnected: () => mocks.connected.map((nodeId) => ({ nodeId })) },
    logGateway: { warn: vi.fn() },
  } as never;
}

async function call(
  method: "trunks.team.propose" | "trunks.team.open" | "trunks.team.retry",
  params: object,
) {
  const respond = vi.fn();
  await trunkTeamHandlers[method]!({ params, respond, context: context() } as never);
  return respond;
}

function payloadOf(respond: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [ok, payload, error] = respond.mock.calls[0] ?? [];
  if (!ok) {
    throw new Error((error as { message?: string } | undefined)?.message ?? "failed");
  }
  return payload as Record<string, unknown>;
}

async function proposalHash(roles?: object[]): Promise<string> {
  const respond = await call("trunks.team.propose", { goal, ...(roles ? { roles } : {}) });
  return (payloadOf(respond).proposal as { hash: string }).hash;
}

beforeEach(() => {
  // Each test gets its own goal: an open approval stays in the registry until the owner answers it.
  goal = `Ship newsletter ${++goals}`;
  mocks.rooms.clear();
  mocks.queue.length = 0;
  mocks.createAgent.mockReset();
  mocks.approval.mockReset();
  mocks.answer = "allow";
  mocks.registerFails = false;
  mocks.gate = Promise.resolve();
  mocks.records = 0;
  mocks.connected = [];
  mocks.cfg = {
    agents: {
      defaults: { model: "anthropic/claude-sonnet" },
      entries: { main: {} },
    },
  };
  mocks.approval.mockImplementation(async (params: { onRecord?: (id: string) => void }) => {
    if (mocks.answer === "unavailable") {
      return "unavailable";
    }
    if (mocks.registerFails) {
      throw new Error("register failed");
    }
    params.onRecord?.(`appr-${++mocks.records}`);
    await mocks.gate;
    return mocks.answer;
  });
  mocks.createAgent.mockImplementation(
    async (params: { entry: { id: string; tools?: unknown } }) => {
      mocks.cfg.agents!.entries![params.entry.id] = { tools: params.entry.tools };
      return { status: "created", agentId: params.entry.id, name: params.entry.id };
    },
  );
});

describe("trunks.team.propose", () => {
  it("only proposes: nothing is created and nothing is asked", async () => {
    const respond = await call("trunks.team.propose", { goal });

    expect(payloadOf(respond)).toMatchObject({
      proposal: expect.anything(),
      choices: expect.anything(),
    });
    expect(mocks.approval).not.toHaveBeenCalled();
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });
});

describe("trunks.team.open", () => {
  it("opens the approval the Inbox shows, and creates nothing until the owner allows it", async () => {
    const hash = await proposalHash();
    mocks.gate = new Promise<void>(() => {});

    const respond = await call("trunks.team.open", { goal, proposalHash: hash });

    expect(payloadOf(respond)).toEqual({ status: "pending", approvalId: "appr-1" });
    expect(mocks.approval).toHaveBeenCalledTimes(1);
    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.rooms.size).toBe(0);
  });

  it("refuses a proposal whose team changed since it was shown, and opens nothing", async () => {
    const hash = await proposalHash();
    mocks.cfg.agents!.defaults = { model: "openai/gpt" };

    const respond = await call("trunks.team.open", { goal, proposalHash: hash });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(mocks.approval).not.toHaveBeenCalled();
  });

  it("shows the same approval for a proposal that is already open", async () => {
    const hash = await proposalHash();
    mocks.gate = new Promise<void>(() => {});

    const first = payloadOf(await call("trunks.team.open", { goal, proposalHash: hash }));
    const second = payloadOf(await call("trunks.team.open", { goal, proposalHash: hash }));

    expect(second).toEqual(first);
    expect(mocks.approval).toHaveBeenCalledTimes(1);
  });

  it("creates nothing when the owner declines the record", async () => {
    const hash = await proposalHash();
    mocks.answer = "deny";

    await call("trunks.team.open", { goal, proposalHash: hash });
    await flush();

    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.rooms.size).toBe(0);
    expect(mocks.queue).toHaveLength(0);
  });

  it("reports unavailable when no approval surface exists, and creates nothing", async () => {
    const hash = await proposalHash();
    mocks.answer = "unavailable";

    const respond = await call("trunks.team.open", { goal, proposalHash: hash });
    await flush();

    expect(payloadOf(respond)).toMatchObject({ status: "unavailable" });
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });

  it("applies the team once the owner allows the record: three Trunks, one room, three jobs", async () => {
    const hash = await proposalHash();

    await call("trunks.team.open", { goal, proposalHash: hash });
    await vi.waitFor(() => expect(mocks.createAgent).toHaveBeenCalledTimes(3));

    for (const [params] of mocks.createAgent.mock.calls) {
      expect(params).toMatchObject({ skipBootstrap: true, model: "anthropic/claude-sonnet" });
    }
    expect(mocks.rooms.size).toBe(1);
    expect(mocks.queue).toHaveLength(3);
  });

  it("creates each Trunk once when the owner allows the same team twice", async () => {
    const hash = await proposalHash();
    let release: () => void = () => undefined;
    mocks.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await call("trunks.team.open", { goal, proposalHash: hash });
    await call("trunks.team.open", { goal, proposalHash: hash });
    release();
    await vi.waitFor(() => expect(mocks.createAgent).toHaveBeenCalledTimes(3));
    await flush();

    expect(mocks.approval).toHaveBeenCalledTimes(1);
    expect(mocks.createAgent).toHaveBeenCalledTimes(3);
    expect(mocks.rooms.size).toBe(1);
    expect(mocks.queue).toHaveLength(3);
  });

  it("answers an applied team from its record, and asks nothing again", async () => {
    const hash = await proposalHash();
    await call("trunks.team.open", { goal, proposalHash: hash });
    await vi.waitFor(() => expect(mocks.createAgent).toHaveBeenCalledTimes(3));
    await flush();

    const again = payloadOf(await call("trunks.team.open", { goal, proposalHash: hash }));

    expect(again).toMatchObject({ status: "applied", created: expect.any(Array) });
    expect(mocks.approval).toHaveBeenCalledTimes(1);
    expect(mocks.createAgent).toHaveBeenCalledTimes(3);
  });

  it("never reopens a declined proposal, and asks the owner nothing again", async () => {
    const hash = await proposalHash();
    mocks.answer = "deny";
    await call("trunks.team.open", { goal, proposalHash: hash });
    await flush();

    const again = payloadOf(await call("trunks.team.open", { goal, proposalHash: hash }));

    expect(again).toEqual({ status: "declined" });
    expect(mocks.approval).toHaveBeenCalledTimes(1);
  });

  it("opens a new approval once the old one expired, and never applies the expired one", async () => {
    const hash = await proposalHash();
    mocks.answer = "expired";
    await call("trunks.team.open", { goal, proposalHash: hash });
    await flush();
    expect(mocks.createAgent).not.toHaveBeenCalled();

    mocks.answer = "allow";
    const reopened = payloadOf(await call("trunks.team.open", { goal, proposalHash: hash }));

    expect(reopened).toEqual({ status: "pending", approvalId: "appr-2" });
    expect(mocks.approval).toHaveBeenCalledTimes(2);
  });

  it("keeps no record id when the approval does not register, and says so", async () => {
    const hash = await proposalHash();
    mocks.registerFails = true;

    const respond = await call("trunks.team.open", { goal, proposalHash: hash });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(respond.mock.calls[0]?.[2]).toMatchObject({
      message: expect.stringContaining("could not be opened"),
    });
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });

  it("refuses to apply a team whose computers or models changed while the card waited", async () => {
    const hash = await proposalHash();
    mocks.gate = new Promise<void>(() => {});
    await call("trunks.team.open", { goal, proposalHash: hash });
    mocks.cfg.agents!.defaults = { model: "openai/gpt" };

    mocks.gate = Promise.resolve();
    await vi.waitFor(() => expect(mocks.approval).toHaveBeenCalled());
    await flush();

    expect(mocks.createAgent).not.toHaveBeenCalled();
  });
});

describe("placement on create", () => {
  it("binds a remote computer into the Trunk's config, and leaves this computer as the default", async () => {
    mocks.connected = ["node-a"];
    const hash = await proposalHash();

    await call("trunks.team.open", { goal, proposalHash: hash });
    await vi.waitFor(() => expect(mocks.createAgent).toHaveBeenCalledTimes(3));

    const entries = mocks.createAgent.mock.calls.map(
      ([params]) => params.entry as { id: string; tools?: unknown },
    );
    const remote = entries.filter(
      (entry) => (entry.tools as { exec?: { node?: string } } | undefined)?.exec?.node === "node-a",
    );
    expect(remote).toHaveLength(1);
    expect(remote[0]?.tools).toEqual({ exec: { host: "node", node: "node-a" } });
    expect(entries.filter((entry) => entry.tools === undefined)).toHaveLength(2);
  });
});

describe("retry after a partial failure", () => {
  it("shows the failure on the record, and finishes the team only when retried", async () => {
    const hash = await proposalHash();
    let failNext = true;
    mocks.createAgent.mockImplementation(async (params: { entry: { id: string } }) => {
      if (failNext) {
        failNext = false;
        throw new Error("gateway busy");
      }
      mocks.cfg.agents!.entries![params.entry.id] = {};
      return { status: "created", agentId: params.entry.id, name: "x" };
    });

    await call("trunks.team.open", { goal, proposalHash: hash });
    await vi.waitFor(() => expect(mocks.createAgent).toHaveBeenCalledTimes(1));
    await flush();
    expect(payloadOf(await call("trunks.team.open", { goal, proposalHash: hash }))).toMatchObject({
      status: "failed",
      message: expect.stringContaining("Retry"),
    });
    expect(mocks.rooms.size).toBe(0);

    const retried = payloadOf(await call("trunks.team.retry", { goal, proposalHash: hash }));

    expect(retried).toMatchObject({ status: "applied" });
    expect(mocks.createAgent).toHaveBeenCalledTimes(4);
    expect(new Set(Object.keys(mocks.cfg.agents!.entries!)).size).toBe(4);
    expect(mocks.rooms.size).toBe(1);
    expect(mocks.queue).toHaveLength(3);
  });

  it("refuses a retry for a team that has not failed", async () => {
    const hash = await proposalHash();

    const respond = await call("trunks.team.retry", { goal, proposalHash: hash });

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });
});
