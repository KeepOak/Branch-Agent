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
  persist: vi.fn(),
  outsideList: vi.fn(),
  outsideRefusal: vi.fn(),
}));
vi.mock("../contacts/outside-agents.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../contacts/outside-agents.js")>()),
  listOutsideAgents: mocks.outsideList,
  outsideAgentRefusal: mocks.outsideRefusal,
}));
vi.mock("../../config/sessions/session-accessor.js", () => ({
  persistSessionTranscriptTurn: mocks.persist,
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

describe("rooms.send mention activation", () => {
  let directory: string;
  let previous: string | undefined;
  let created: boolean;
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
    directory = mkdtempSync(path.join(tmpdir(), "branch-room-mention-"));
    previous = process.env.BRANCH_STATE_DIR;
    process.env.BRANCH_STATE_DIR = directory;
    created = false;
    vi.clearAllMocks();
    mocks.roster.mockResolvedValue({
      agents: [
        { id: "lead", name: "TK", kind: "agent" },
        { id: "scout", name: "Scout", kind: "agent" },
      ],
    });
    mocks.authorize.mockReturnValue(undefined);
    mocks.outsideList.mockReturnValue([]);
    mocks.outsideRefusal.mockReturnValue(undefined);
    mocks.load.mockImplementation(() => ({
      entry: created ? { sessionId: "room-session" } : undefined,
      storePath: "room-store",
    }));
    mocks.create.mockImplementation(async (options: GatewayRequestHandlerOptions) => {
      created = true;
      options.respond(
        true,
        options.params.message
          ? { runStarted: true, runId: "run-one" }
          : { key: options.params.key },
      );
    });
    mocks.send.mockImplementation(async (options: GatewayRequestHandlerOptions) =>
      options.respond(true, { runId: "run-two" }),
    );
    mocks.persist.mockResolvedValue({ messages: [{ messageId: "posted" }] });
  });
  afterEach(() => {
    closeBranchStateDatabaseForTest();
    if (previous === undefined) delete process.env.BRANCH_STATE_DIR;
    else process.env.BRANCH_STATE_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  async function room(rule: "mentions" | "lead") {
    return (
      await call("rooms.create", {
        name: "Builders",
        rule,
        members: [
          { kind: "trunk", id: "lead", role: "lead" },
          { kind: "trunk", id: "scout" },
        ],
      })
    ).room;
  }

  it("logs an unmentioned post in room history without starting a lead turn", async () => {
    const target = await room("mentions");
    const result = await call("rooms.send", { roomId: target.roomId, message: "Status update" });
    expect(result).toMatchObject({ event: { kind: "message" }, runStarted: false });
    expect(result.sessionKey).toBe(`agent:lead:room:${target.roomId}`);
    expect(mocks.create.mock.calls[0]![0].params).toEqual({
      key: `agent:lead:room:${target.roomId}`,
      agentId: "lead",
    });
    expect(mocks.persist.mock.calls[0]![0]).toMatchObject({
      sessionKey: `agent:lead:room:${target.roomId}`,
      sessionId: "room-session",
    });
    expect(mocks.persist.mock.calls[0]![1].messages[0].message).toMatchObject({
      role: "user",
      content: "Status update",
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(
      (await call("rooms.log", { roomId: target.roomId })).events.map(
        (event: { kind: string }) => event.kind,
      ),
    ).toEqual(["created", "message"]);
    expect(broadcast.mock.calls.map(([name]) => name)).toEqual(["rooms.changed", "rooms.event", "rooms.event"]);
  });

  it("starts the lead for a case-insensitive name mention", async () => {
    const target = await room("mentions");
    const result = await call("rooms.send", {
      roomId: target.roomId,
      message: "@tk, please review",
    });
    expect(result.runStarted).toBe(true);
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(
      (await call("rooms.log", { roomId: target.roomId })).events.map(
        (event: { kind: string }) => event.kind,
      ),
    ).toEqual(["created", "message", "turn.started"]);
  });

  it.each(["TK, please review", "@lead, please review", "@Scout, please review"])(
    "starts the lead when the post names an enabled member: %s",
    async (message) => {
      const target = await room("mentions");
      expect((await call("rooms.send", { roomId: target.roomId, message })).runStarted).toBe(true);
      expect(mocks.persist).not.toHaveBeenCalled();
    },
  );

  it("does not treat a plain mention of the lead's id as an activation", async () => {
    mocks.roster.mockResolvedValue({ agents: [{ id: "main", name: "TK", kind: "agent" }] });
    const target = (
      await call("rooms.create", {
        name: "Builders",
        rule: "mentions",
        members: [{ kind: "trunk", id: "main", role: "lead" }],
      })
    ).room;
    const result = await call("rooms.send", { roomId: target.roomId, message: "the main issue" });
    expect(result.runStarted).toBe(false);
    expect(result.sessionKey).toBe(`agent:main:room:${target.roomId}`);
  });

  it("does not activate on an outside sender's own name", async () => {
    const outside = { id: "claude-code", name: "Claude Code", where: "LEGION" };
    mocks.outsideList.mockReturnValue([outside]);
    const target = (
      await call("rooms.create", {
        name: "Builders",
        rule: "mentions",
        members: [
          { kind: "trunk", id: "lead", role: "lead" },
          { kind: "a2a", id: outside.id },
        ],
      })
    ).room;
    const result = await call("rooms.send", {
      roomId: target.roomId,
      message: "Claude Code has an update",
      outsideAgent: outside,
    });
    expect(result.runStarted).toBe(false);
    expect(mocks.persist).toHaveBeenCalledOnce();
  });

  it("keeps the lead rule's turn-per-message behavior", async () => {
    const target = await room("lead");
    expect(
      (await call("rooms.send", { roomId: target.roomId, message: "Status update" })).runStarted,
    ).toBe(true);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
