import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import type { GatewayRequestHandlerOptions } from "../server-methods/types.js";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  send: vi.fn(),
  load: vi.fn(),
  roster: vi.fn(),
  authorize: vi.fn(),
  wait: vi.fn(),
}));
vi.mock("../server-methods/agent-wait.js", () => ({ agentWaitHandler: mocks.wait }));
vi.mock("../server-methods/sessions-create.js", () => ({
  sessionCreateHandlers: { "sessions.create": mocks.create },
}));
vi.mock("../server-methods/sessions-messaging.js", () => ({
  sessionMessagingHandlers: { "sessions.send": mocks.send },
}));
vi.mock("../server-methods/session-mutation-guards.js", () => ({
  bindGatewayRequestHandlerMutationAuthority: (_source: unknown, target: unknown) => target,
}));
vi.mock("../session-utils.js", () => ({ loadGatewaySessionEntryReadOnly: mocks.load }));
vi.mock("../agent-list.js", () => ({ listGatewayAgentsBasic: mocks.roster }));
vi.mock("../operator-role-policy.js", () => ({ authorizeGatewaySessionCreation: mocks.authorize }));

import { roomHandlers } from "../server-methods/rooms.js";

describe("rooms methods", () => {
  let directory: string, previous: string | undefined;
  const broadcast = vi.fn();
  async function call(method: string, params: Record<string, unknown>) {
    const respond = vi.fn();
    await roomHandlers[method]!({
      params,
      respond,
      context: { getRuntimeConfig: () => ({}), broadcast },
      client: null,
    } as unknown as GatewayRequestHandlerOptions);
    const [ok, payload, error] = respond.mock.calls.at(-1)!;
    if (!ok) {
      throw new Error(error?.message ?? `${method} failed`);
    }
    return payload as Record<string, any>;
  }
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "branch-room-rpc-"));
    previous = process.env.BRANCH_STATE_DIR;
    process.env.BRANCH_STATE_DIR = directory;
    vi.clearAllMocks();
    mocks.roster.mockResolvedValue({ agents: [{ id: "scout", kind: "agent" }] });
    mocks.authorize.mockReturnValue(undefined);
    mocks.load.mockReturnValue({ entry: undefined });
    mocks.create.mockImplementation(async (options: GatewayRequestHandlerOptions) =>
      options.respond(true, { runStarted: true, runId: "run-one" }),
    );
    mocks.send.mockImplementation(async (options: GatewayRequestHandlerOptions) =>
      options.respond(true, { runId: "run-two" }),
    );
    mocks.wait.mockImplementation(async (options: GatewayRequestHandlerOptions) =>
      options.respond(true, { status: "ok" }),
    );
  });
  afterEach(() => {
    closeBranchStateDatabaseForTest();
    if (previous === undefined) {
      delete process.env.BRANCH_STATE_DIR;
    } else {
      process.env.BRANCH_STATE_DIR = previous;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it("publishes changes and events and creates the lead session only with the first message", async () => {
    const { room } = await call("rooms.create", {
      name: "Plan",
      members: [{ kind: "trunk", id: "scout", role: "lead" }],
    });
    const key = `agent:scout:room:${room.roomId}`;
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await call("rooms.list", {})).rooms).toHaveLength(1);
    expect((await call("rooms.get", { roomId: room.roomId })).room.lead).toBe("scout");
    const first = await call("rooms.send", { roomId: room.roomId, message: "Draft a plan" });
    expect(first).toMatchObject({ sessionKey: key, runId: "run-one", runStarted: true });
    expect(mocks.create.mock.calls[0]![0].params).toEqual({
      key,
      agentId: "scout",
      message: "Draft a plan",
    });
    expect(
      (await call("rooms.log", { roomId: room.roomId })).events.map(
        (value: { kind: string }) => value.kind,
      ),
    ).toEqual(["created", "message", "turn.started"]);
    mocks.load.mockReturnValue({ entry: { sessionId: "existing" } });
    await call("rooms.send", { roomId: room.roomId, message: "Revise it" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]![0].params).toEqual({
      key,
      agentId: "scout",
      message: "Revise it",
    });
    expect(broadcast.mock.calls.map(([name]) => name)).toEqual([
      "rooms.changed",
      "rooms.event",
      "rooms.event",
      "rooms.event",
      "rooms.event",
      "rooms.event",
    ]);
    expect(
      (await call("rooms.rule.set", { roomId: room.roomId, rule: "mentions" })).room.rule,
    ).toBe("mentions");
    expect(
      (await call("rooms.members.add", { roomId: room.roomId, kind: "person", id: "alex" })).room
        .members,
    ).toHaveLength(2);
    expect(
      (await call("rooms.members.remove", { roomId: room.roomId, kind: "person", id: "alex" })).room
        .members,
    ).toHaveLength(1);
    expect((await call("rooms.archive", { roomId: room.roomId })).room.archivedAt).toBeGreaterThan(
      0,
    );
  });
  it("creates a dropped contact room and records its added member through rooms methods", async () => {
    const { room } = await call("rooms.create", {
      name: "Scout and Ledger",
      members: [
        { kind: "trunk", id: "scout", role: "lead" },
        { kind: "a2a", id: "ledger" },
      ],
    });
    expect(
      room.members.map((member: { kind: string; id: string }) => `${member.kind}:${member.id}`),
    ).toEqual(["trunk:scout", "a2a:ledger"]);
    const added = (
      await call("rooms.members.add", { roomId: room.roomId, kind: "person", id: "ada" })
    ).room;
    expect(added.members.at(-1)).toMatchObject({ kind: "person", id: "ada" });
    expect((await call("rooms.log", { roomId: room.roomId })).events).toMatchObject([
      {
        kind: "created",
        payload: {
          members: [
            { kind: "trunk", id: "scout" },
            { kind: "a2a", id: "ledger" },
          ],
        },
      },
      { kind: "member.added", payload: { kind: "person", id: "ada" } },
    ]);
  });
  describe("Trunk turns", () => {
    const names = { ada: "Ada", bo: "Bo", cy: "Cy" } as const;
    let replies: Record<string, (turn: number) => string>;
    beforeEach(() => {
      mocks.roster.mockResolvedValue({
        agents: Object.entries(names).map(([id, name]) => ({ id, name, kind: "agent" })),
      });
      const runs = new Map<string, string>();
      mocks.create.mockImplementation(async (options: GatewayRequestHandlerOptions) => {
        const runId = `run-${runs.size + 1}`;
        runs.set(runId, options.params.agentId as string);
        options.respond(true, { runStarted: true, runId });
      });
      mocks.wait.mockImplementation(async (options: GatewayRequestHandlerOptions) => {
        const agentId = runs.get(options.params.runId as string)!;
        const turn = [...runs.values()].filter((id) => id === agentId).length;
        options.respond(true, {
          status: "ok",
          terminalReply: { disposition: "visible", text: replies[agentId]!(turn) },
        });
      });
    });
    async function events(roomId: string) {
      return (await call("rooms.log", { roomId })).events as {
        kind: string;
        actorId: string;
        payload: Record<string, unknown>;
      }[];
    }
    const actors = (list: { kind: string; actorId: string }[], kind: string) =>
      list.filter((value) => value.kind === kind).map((value) => value.actorId);

    it("gives each Trunk a turn in member order for rule everyone, each seeing earlier replies", async () => {
      replies = { ada: () => "Plan A", bo: () => "Plan B", cy: () => "Plan C" };
      const { room } = await call("rooms.create", {
        name: "Plan",
        rule: "everyone",
        members: [
          { kind: "trunk", id: "bo" },
          { kind: "trunk", id: "ada", role: "lead" },
          { kind: "trunk", id: "cy" },
        ],
      });
      const sent = await call("rooms.send", { roomId: room.roomId, message: "Draft a plan" });
      expect(sent).toMatchObject({ sessionKey: `agent:bo:room:${room.roomId}`, runStarted: true });
      await vi.waitFor(async () =>
        expect(actors(await events(room.roomId), "turn.replied")).toEqual(["bo", "ada", "cy"]),
      );
      expect(actors(await events(room.roomId), "turn.started")).toEqual(["bo", "ada", "cy"]);
      expect(mocks.create.mock.calls.map(([options]) => options.params)).toEqual([
        { key: `agent:bo:room:${room.roomId}`, agentId: "bo", message: "Draft a plan" },
        {
          key: `agent:ada:room:${room.roomId}`,
          agentId: "ada",
          message: "Draft a plan\n\nEarlier replies in this group chat:\n\nBo: Plan B",
        },
        {
          key: `agent:cy:room:${room.roomId}`,
          agentId: "cy",
          message:
            "Draft a plan\n\nEarlier replies in this group chat:\n\nBo: Plan B\n\nAda: Plan A",
        },
      ]);
    });

    it("C01: one human post gets three distinct replies without overlapping Trunk turns", async () => {
      const pending = new Map<string, () => void>();
      mocks.wait.mockImplementation(async (options: GatewayRequestHandlerOptions) => {
        await new Promise<void>((resolve) => {
          pending.set(options.params.runId as string, resolve);
        });
        options.respond(true, {
          status: "ok",
          terminalReply: { disposition: "visible", text: `Reply ${options.params.runId}` },
        });
      });
      const ids = ["bo", "ada", "cy"];
      const { room } = await call("rooms.create", {
        name: "C01",
        rule: "everyone",
        members: ids.map((id) => ({ kind: "trunk", id })),
      });
      await call("rooms.send", { roomId: room.roomId, message: "Report in, in order." });
      for (let index = 0; index < ids.length; index += 1) {
        const runId = `run-${index + 1}`;
        await vi.waitFor(() => expect(pending.has(runId)).toBe(true));
        const log = await events(room.roomId);
        expect(actors(log, "turn.started")).toEqual(ids.slice(0, index + 1));
        expect(actors(log, "turn.replied")).toEqual(ids.slice(0, index));
        pending.get(runId)!();
      }
      await vi.waitFor(async () =>
        expect(actors(await events(room.roomId), "turn.replied")).toEqual(ids),
      );
      const log = await events(room.roomId);
      expect(new Set(actors(log, "turn.replied")).size).toBe(3);
      expect(actors(log, "message")).toEqual(["owner"]);
      expect(
        log
          .filter((value) => value.kind.startsWith("turn."))
          .map(({ kind, actorId }) => `${kind}:${actorId}`),
      ).toEqual(ids.flatMap((id) => [`turn.started:${id}`, `turn.replied:${id}`]));
    });

    it("wakes a Trunk that another Trunk's reply @mentions when Trunks talk", async () => {
      replies = { ada: () => "@Bo can you check the numbers?", bo: () => "Checked, they add up." };
      const { room } = await call("rooms.create", {
        name: "Plan",
        trunksTalk: true,
        members: [
          { kind: "trunk", id: "ada", role: "lead" },
          { kind: "trunk", id: "bo" },
          { kind: "trunk", id: "cy" },
        ],
      });
      await call("rooms.send", { roomId: room.roomId, message: "Check the budget" });
      await vi.waitFor(async () =>
        expect(actors(await events(room.roomId), "turn.replied")).toEqual(["ada", "bo"]),
      );
      expect(actors(await events(room.roomId), "turn.started")).toEqual(["ada", "bo"]);
      expect(mocks.create.mock.calls[1]![0].params).toEqual({
        key: `agent:bo:room:${room.roomId}`,
        agentId: "bo",
        message: "Ada: @Bo can you check the numbers?",
      });
      expect((await events(room.roomId)).some((value) => value.kind === "note")).toBe(false);
    });

    it("stops Trunk-to-Trunk ping-pong after the round limit and posts a note", async () => {
      replies = {
        ada: (turn) => `@Bo over to you (${turn})`,
        bo: (turn) => `@Ada back to you (${turn})`,
      };
      const { room } = await call("rooms.create", {
        name: "Plan",
        trunksTalk: true,
        members: [
          { kind: "trunk", id: "ada", role: "lead" },
          { kind: "trunk", id: "bo" },
        ],
      });
      await call("rooms.send", { roomId: room.roomId, message: "Discuss" });
      await vi.waitFor(async () =>
        expect((await events(room.roomId)).at(-1)).toMatchObject({
          kind: "note",
          payload: { text: "Trunks stopped after 6 back-and-forth turns. Post again to continue." },
        }),
      );
      const log = await events(room.roomId);
      expect(actors(log, "turn.started")).toEqual(["ada", "bo", "ada", "bo", "ada", "bo", "ada"]);
      expect(log.filter((value) => value.kind === "note")).toHaveLength(1);
    });

    it("wakes each of 20 Trunks one at a time in member order, never above the host limit", async () => {
      const ids = Array.from({ length: 20 }, (_, index) => `t${String(index).padStart(2, "0")}`);
      mocks.roster.mockResolvedValue({
        agents: ids.map((id) => ({ id, name: id.toUpperCase(), kind: "agent" })),
      });
      const runs = new Map<string, string>();
      let running = 0,
        most = 0;
      mocks.create.mockImplementation(async (options: GatewayRequestHandlerOptions) => {
        const runId = `run-${runs.size + 1}`;
        runs.set(runId, options.params.agentId as string);
        running += 1;
        most = Math.max(most, running);
        options.respond(true, { runStarted: true, runId });
      });
      mocks.wait.mockImplementation(async (options: GatewayRequestHandlerOptions) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 1);
        });
        running -= 1;
        const agentId = runs.get(options.params.runId as string)!;
        options.respond(true, {
          status: "ok",
          terminalReply: { disposition: "visible", text: `${agentId} done` },
        });
      });
      // One host whose agent lane admits a single run at a time.
      const hostLimit = 1;
      const respond = vi.fn();
      const options = (method: string, params: Record<string, unknown>) =>
        ({
          params,
          respond,
          context: {
            getRuntimeConfig: () => ({ agents: { defaults: { maxConcurrent: hostLimit } } }),
            broadcast,
          },
          client: null,
        }) as unknown as GatewayRequestHandlerOptions;
      await roomHandlers["rooms.create"]!(
        options("rooms.create", {
          name: "Everyone",
          rule: "everyone",
          members: ids.map((id) => ({ kind: "trunk", id })),
        }),
      );
      const [created, { room }] = respond.mock.calls.at(-1)!;
      expect(created).toBe(true);
      expect(room.members).toHaveLength(20);
      await roomHandlers["rooms.send"]!(
        options("rooms.send", { roomId: room.roomId, message: "Report in" }),
      );
      expect(respond.mock.calls.at(-1)![0]).toBe(true);
      await vi.waitFor(
        async () => expect(actors(await events(room.roomId), "turn.replied")).toEqual(ids),
        { timeout: 10_000 },
      );
      expect(actors(await events(room.roomId), "turn.started")).toEqual(ids);
      expect(most).toBe(hostLimit);
    });
  });
  it("records an outside agent joining itself as the actor", async () => {
    const { room } = await call("rooms.create", {
      name: "Plan",
      members: [{ kind: "trunk", id: "scout", role: "lead" }],
    });
    const outsideAgent = { id: "ledger", name: "Ledger", where: "Graft" };
    await call("rooms.members.add", {
      roomId: room.roomId,
      kind: "a2a",
      id: "ledger",
      outsideAgent,
    });
    expect((await call("rooms.log", { roomId: room.roomId })).events.at(-1)).toMatchObject({
      kind: "member.added",
      actorId: "a2a:ledger",
      payload: { kind: "a2a", id: "ledger", from: "Ledger" },
    });
  });
});
