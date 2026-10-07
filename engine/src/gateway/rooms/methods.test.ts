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
}));
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
    if (!ok) throw new Error(error?.message ?? `${method} failed`);
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
  });
  afterEach(() => {
    closeBranchStateDatabaseForTest();
    if (previous === undefined) delete process.env.BRANCH_STATE_DIR;
    else process.env.BRANCH_STATE_DIR = previous;
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
      "rooms.changed", "rooms.event",
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
      members: [{ kind: "trunk", id: "scout", role: "lead" }, { kind: "a2a", id: "ledger" }],
    });
    expect(room.members.map((member: { kind: string; id: string }) => `${member.kind}:${member.id}`)).toEqual(["trunk:scout", "a2a:ledger"]);
    const added = (await call("rooms.members.add", { roomId: room.roomId, kind: "person", id: "ada" })).room;
    expect(added.members.at(-1)).toMatchObject({ kind: "person", id: "ada" });
    expect((await call("rooms.log", { roomId: room.roomId })).events).toMatchObject([
      { kind: "created", payload: { members: [{ kind: "trunk", id: "scout" }, { kind: "a2a", id: "ledger" }] } },
      { kind: "member.added", payload: { kind: "person", id: "ada" } },
    ]);
  });
  it("records an outside agent joining itself as the actor", async () => {
    const { room } = await call("rooms.create", { name: "Plan", members: [{ kind: "trunk", id: "scout", role: "lead" }] });
    const outsideAgent = { id: "ledger", name: "Ledger", where: "Graft" };
    await call("rooms.members.add", { roomId: room.roomId, kind: "a2a", id: "ledger", outsideAgent });
    expect((await call("rooms.log", { roomId: room.roomId })).events.at(-1)).toMatchObject({
      kind: "member.added", actorId: "a2a:ledger", payload: { kind: "a2a", id: "ledger", from: "Ledger" },
    });
  });
});
