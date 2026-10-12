// A Graft agent's post in a group chat reaches the lead Trunk as that agent's own message (chat.send outsideAgent),
// so the room conversation draws it with the agent's name, face and A2A badge instead of as the owner's.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import type { GatewayRequestHandlerOptions } from "../server-methods/types.js";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  send: vi.fn(),
  chatSend: vi.fn(),
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
vi.mock("../server-methods/chat-send-external-entry.js", () => ({
  handleDirectExternalChatSend: mocks.chatSend,
}));
vi.mock("../server-methods/session-mutation-guards.js", () => ({
  bindGatewayRequestHandlerMutationAuthority: (_source: unknown, target: unknown) => target,
}));
vi.mock("../session-utils.js", () => ({ loadGatewaySessionEntryReadOnly: mocks.load }));
vi.mock("../agent-list.js", () => ({ listGatewayAgentsBasic: mocks.roster }));
vi.mock("../operator-role-policy.js", () => ({ authorizeGatewaySessionCreation: mocks.authorize }));

import { roomHandlers } from "../server-methods/rooms.js";

const claude = { id: "claude-code-a1b2c3", name: "Claude Code", where: "LEGION" };

describe("a Graft post in a group chat keeps its sender", () => {
  let directory: string, previous: string | undefined;
  async function call(method: string, params: Record<string, unknown>) {
    const respond = vi.fn();
    await roomHandlers[method]!({
      params,
      respond,
      context: { getRuntimeConfig: () => ({}), broadcast: vi.fn() },
      client: null,
    } as unknown as GatewayRequestHandlerOptions);
    const [ok, payload, error] = respond.mock.calls.at(-1)!;
    if (!ok) throw new Error(error?.message ?? `${method} failed`);
    return payload as Record<string, any>;
  }
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "branch-room-sender-"));
    previous = process.env.BRANCH_STATE_DIR;
    process.env.BRANCH_STATE_DIR = directory;
    vi.clearAllMocks();
    mocks.roster.mockResolvedValue({ agents: [{ id: "scout", kind: "agent" }] });
    mocks.authorize.mockReturnValue(undefined);
    mocks.load.mockReturnValue({ entry: undefined });
    mocks.create.mockImplementation(async (o: GatewayRequestHandlerOptions) =>
      o.respond(true, { key: o.params.key }),
    );
    mocks.chatSend.mockImplementation(async (o: GatewayRequestHandlerOptions) =>
      o.respond(true, { runId: "run-a", status: "started" }),
    );
  });
  afterEach(() => {
    closeBranchStateDatabaseForTest();
    if (previous === undefined) delete process.env.BRANCH_STATE_DIR;
    else process.env.BRANCH_STATE_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });

  it("creates the lead conversation without a message, then sends the post as the agent", async () => {
    const { room } = await call("rooms.create", {
      name: "Builders",
      members: [
        { kind: "trunk", id: "scout", role: "lead" },
        { kind: "a2a", id: claude.id },
      ],
    });
    const key = `agent:scout:room:${room.roomId}`;
    const sent = await call("rooms.send", {
      roomId: room.roomId,
      message: "Ship it",
      outsideAgent: claude,
    });
    expect(sent).toMatchObject({ sessionKey: key, runId: "run-a", runStarted: true });
    expect(mocks.create.mock.calls[0]![0].params).toEqual({ key, agentId: "scout" });
    const params = mocks.chatSend.mock.calls[0]![0].params;
    expect(params).toMatchObject({
      sessionKey: key,
      agentId: "scout",
      message: "Ship it",
      deliver: false,
      outsideAgent: claude,
    });
    expect(params.idempotencyKey).toEqual(expect.any(String));
    expect(mocks.send).not.toHaveBeenCalled();
    // The room log keeps the agent as the poster too.
    const log = (await call("rooms.log", { roomId: room.roomId })).events as {
      kind: string;
      actorId: string;
      payload: any;
    }[];
    expect(log.find((e) => e.kind === "message")).toMatchObject({
      actorId: `a2a:${claude.id}`,
      payload: { text: "Ship it", from: "Claude Code" },
    });
  });

  it("reuses the lead conversation once it exists", async () => {
    const { room } = await call("rooms.create", {
      name: "Builders",
      members: [
        { kind: "trunk", id: "scout", role: "lead" },
        { kind: "a2a", id: claude.id },
      ],
    });
    mocks.load.mockReturnValue({ entry: { sessionId: "s1" } });
    await call("rooms.send", { roomId: room.roomId, message: "Again", outsideAgent: claude });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.chatSend.mock.calls[0]![0].params).toMatchObject({
      message: "Again",
      outsideAgent: claude,
    });
  });

  it("the owner's own posts still go through sessions.create / sessions.send", async () => {
    const { room } = await call("rooms.create", {
      name: "Plan",
      members: [{ kind: "trunk", id: "scout", role: "lead" }],
    });
    mocks.create.mockImplementation(async (o: GatewayRequestHandlerOptions) =>
      o.respond(true, { runStarted: true, runId: "r1" }),
    );
    await call("rooms.send", { roomId: room.roomId, message: "Draft" });
    expect(mocks.chatSend).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0]![0].params).toMatchObject({ message: "Draft" });
  });
});
