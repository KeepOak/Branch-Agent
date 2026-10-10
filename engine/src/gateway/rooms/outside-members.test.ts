import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/config.js";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import { recordOutsideAgent, updateOutsideAgentSettings } from "../contacts/outside-agents.js";
import type { GatewayRequestHandlerOptions } from "../server-methods/types.js";

const mocks = vi.hoisted(() => ({ persist: vi.fn(), external: vi.fn(), removeDevice: vi.fn() }));
vi.mock("../../config/sessions/session-accessor.js", () => ({
  persistSessionTranscriptTurn: mocks.persist,
  listSessionEntriesReadOnly: vi.fn(),
  patchSessionEntryCore: vi.fn(),
}));
vi.mock("../../agents/tools/agent-step.js", () => ({ runAgentStep: vi.fn() }));
vi.mock("../call.js", () => ({ callGateway: vi.fn() }));
vi.mock("../server-methods/sessions-create.js", () => ({ sessionCreateHandlers: {} }));
vi.mock("../server-methods/sessions-messaging.js", () => ({ sessionMessagingHandlers: {} }));
vi.mock("../server-methods/chat-send-external-entry.js", () => ({
  handleDirectExternalChatSend: mocks.external,
}));
vi.mock("../server-methods/devices.js", () => ({
  deviceHandlers: { "device.pair.remove": mocks.removeDevice },
}));
vi.mock("../server-methods/session-mutation-guards.js", () => ({
  bindGatewayRequestHandlerMutationAuthority: (_source: unknown, target: unknown) => target,
}));
vi.mock("../session-utils.js", () => ({
  loadGatewaySessionEntryReadOnly: () => ({
    entry: { sessionId: "room-session" },
    storePath: "room-store",
  }),
}));
vi.mock("../agent-list.js", () => ({
  listExistingAgentIdsFromDisk: vi.fn(),
  listGatewayAgentsBasic: async () => ({ agents: [{ id: "lead", name: "Lead", kind: "agent" }] }),
}));
vi.mock("../operator-role-policy.js", async (original) => ({
  ...(await original<typeof import("../operator-role-policy.js")>()),
  authorizeGatewaySessionCreation: () => undefined,
}));

import { contactHandlers } from "../server-methods/contacts.js";
import { roomHandlers } from "../server-methods/rooms.js";

describe("outside room membership", () => {
  let directory: string;
  let previous: string | undefined;
  let cfg: BranchConfig;
  const broadcast = vi.fn();
  const outside = { id: "scout", name: "Scout" };
  const owner = { connect: { scopes: ["operator.admin"] } };
  async function call(method: string, params: Record<string, unknown>, client: unknown = owner) {
    const respond = vi.fn();
    await (roomHandlers[method] ?? contactHandlers[method])!({
      params,
      respond,
      client,
      context: { getRuntimeConfig: () => cfg, broadcast },
    } as unknown as GatewayRequestHandlerOptions);
    const [ok, payload, error] = respond.mock.calls.at(-1)!;
    return { ok: ok as boolean, payload, error: error as { message: string } | undefined };
  }
  async function room() {
    const result = await call("rooms.create", {
      name: "Builders",
      rule: "mentions",
      members: [{ kind: "trunk", id: "lead", role: "lead" }],
    });
    expect(result.ok).toBe(true);
    return result.payload.room.roomId as string;
  }
  async function join(roomId: string, agent = outside) {
    return call("rooms.members.add", { roomId, kind: "a2a", id: agent.id, outsideAgent: agent });
  }
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "branch-room-outside-"));
    previous = process.env.BRANCH_STATE_DIR;
    process.env.BRANCH_STATE_DIR = directory;
    cfg = {};
    vi.clearAllMocks();
    recordOutsideAgent(outside);
    mocks.persist.mockResolvedValue({ messages: [{ messageId: "posted" }] });
    mocks.external.mockImplementation(async (options: GatewayRequestHandlerOptions) =>
      options.respond(true, { runId: "room-run" }),
    );
    mocks.removeDevice.mockImplementation(async (options: GatewayRequestHandlerOptions) =>
      options.respond(true, {}),
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

  it("joins and posts as the outside agent with its badge and without owner attribution", async () => {
    const roomId = await room();
    expect((await join(roomId)).ok).toBe(true);
    const result = await call("rooms.send", {
      roomId,
      message: "Status update",
      outsideAgent: outside,
    });
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      event: { actorId: "a2a:scout", payload: { from: "Scout" } },
      runStarted: false,
    });
    const message = mocks.persist.mock.calls[0]![1].messages[0].message;
    expect(message["__branch"]).toMatchObject({
      senderId: "scout",
      senderName: "Scout",
      senderIdentity: { pluginId: "a2a", senderKind: "bot" },
    });
    expect(message["__branch"]).not.toHaveProperty("senderIsOwner");
    const mentioned = await call("rooms.send", {
      roomId,
      message: "@Lead please review",
      outsideAgent: outside,
    });
    expect(mentioned.ok).toBe(true);
    expect(mentioned.payload.runStarted).toBe(true);
    expect(mocks.external.mock.calls[0]![0].params.outsideAgent).toEqual(outside);
  });

  it.each(["join", "post"])(
    "the lead's deny switch blocks an outside %s before any event or transcript is written",
    async (operation) => {
      const roomId = await room();
      if (operation === "post") {
        expect((await join(roomId)).ok).toBe(true);
      }
      cfg = { agents: { entries: { lead: { agentToAgent: { deny: ["a2a:scout"] } } } } };
      const before = (await call("rooms.log", { roomId })).payload.events.length;
      const result =
        operation === "join"
          ? await join(roomId)
          : await call("rooms.send", { roomId, message: "Status update", outsideAgent: outside });
      expect(result.ok).toBe(false);
      expect(result.error?.message).toMatch(/Who it knows.*(turn|enable)/i);
      expect((await call("rooms.log", { roomId })).payload.events).toHaveLength(before);
      expect(mocks.persist).not.toHaveBeenCalled();
      expect(mocks.external).not.toHaveBeenCalled();
    },
  );

  it("does not let a revoked agent rejoin", async () => {
    const roomId = await room();
    updateOutsideAgentSettings({ id: outside.id, revoked: true });
    const result = await join(roomId);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/disconnected.*Settings.*(allow|reconnect)/i);
  });

  it.each([false, true])(
    "Disconnect removes every room membership, including device sibling rows: %s",
    async (device) => {
      const peer = { id: "helper", name: "Helper" };
      if (device) {
        recordOutsideAgent(outside, Date.now(), undefined, { deviceId: "graft-device" });
        recordOutsideAgent(peer, Date.now(), undefined, { deviceId: "graft-device" });
      } else {
        recordOutsideAgent(peer);
      }
      const first = await room();
      const second = await room();
      for (const roomId of [first, second]) {
        expect((await join(roomId)).ok).toBe(true);
        expect((await join(roomId, peer)).ok).toBe(true);
      }
      broadcast.mockClear();
      expect((await call("contacts.outside.set", { id: outside.id, revoked: true })).ok).toBe(true);
      for (const roomId of [first, second]) {
        const members = (await call("rooms.get", { roomId })).payload.room.members;
        expect(members.some((member: { id: string }) => member.id === outside.id)).toBe(false);
        expect(members.some((member: { id: string }) => member.id === peer.id)).toBe(!device);
        expect(broadcast).toHaveBeenCalledWith(
          "rooms.changed",
          expect.objectContaining({ roomId }),
          { dropIfSlow: true },
        );
      }
      expect((await join(first)).ok).toBe(false);
      expect(
        (await call("rooms.send", { roomId: first, message: "No", outsideAgent: outside })).ok,
      ).toBe(false);
    },
  );

  it("outside joins can add only their own identity", async () => {
    const roomId = await room();
    const result = await call("rooms.members.add", {
      roomId,
      kind: "a2a",
      id: "helper",
      outsideAgent: outside,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/own.*identity/i);
  });

  it("a nonmember is told to join before posting", async () => {
    const result = await call("rooms.send", {
      roomId: await room(),
      message: "Hello",
      outsideAgent: outside,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/room_join/);
  });
});
