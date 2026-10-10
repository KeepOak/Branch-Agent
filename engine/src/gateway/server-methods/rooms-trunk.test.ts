import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withGatewayToolCallerIdentity } from "../../agents/tools/gateway-caller-context.js";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import { archiveRoom, createRoom, readRoomLog } from "../rooms/store.js";
import { roomTrunkHandlers } from "./rooms-trunk.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

type Method = keyof typeof roomTrunkHandlers;

/**
 * Runs one Trunk handler. A trunkId means the call came from that Trunk's run, which is the
 * host-owned caller context the agent tool path establishes; no trunkId means a public client.
 */
async function invoke(method: Method, params: Record<string, unknown>, trunkId?: string) {
  const respond = vi.fn();
  const broadcast = vi.fn();
  const options = {
    params,
    respond,
    context: { broadcast },
  } as unknown as GatewayRequestHandlerOptions;
  await withGatewayToolCallerIdentity(
    trunkId ? ({ agentId: trunkId, sessionKey: `agent:${trunkId}:main` } as never) : undefined,
    () => roomTrunkHandlers[method]!(options),
  );
  return { respond, broadcast };
}

function firstResult(respond: ReturnType<typeof vi.fn>) {
  const [ok, payload, error] = respond.mock.calls[0] as [boolean, unknown, { message?: string }?];
  return { ok, payload: payload as Record<string, unknown> | undefined, message: error?.message };
}

describe("rooms.trunk tools", () => {
  let directory: string;
  let previous: string | undefined;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "branch-rooms-trunk-"));
    previous = process.env.BRANCH_STATE_DIR;
    process.env.BRANCH_STATE_DIR = directory;
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

  function groupWith(members: { id: string; enabled?: boolean }[]) {
    return createRoom({
      name: "Builders",
      rule: "mentions",
      members: members.map((m, index) => ({
        kind: "trunk" as const,
        id: m.id,
        role: index === 0 ? ("lead" as const) : ("member" as const),
        enabled: m.enabled ?? true,
      })),
    });
  }

  it("refuses a call that does not come from a Trunk run", async () => {
    const room = groupWith([{ id: "scout" }]);
    const { respond } = await invoke("rooms.trunk.post", { roomId: room.roomId, message: "hi" });
    expect(firstResult(respond)).toMatchObject({ ok: false });
    expect(firstResult(respond).message).toMatch(/only available to a Trunk in its own run/);
    expect(readRoomLog(room.roomId).events).toHaveLength(0);
  });

  it("records a Trunk's post as that Trunk and never starts a turn", async () => {
    const room = groupWith([{ id: "scout" }, { id: "ash" }]);
    const { respond, broadcast } = await invoke(
      "rooms.trunk.post",
      { roomId: room.roomId, message: "PR 900 ready for review, @ash please take it" },
      "scout",
    );
    expect(firstResult(respond).ok).toBe(true);
    const events = readRoomLog(room.roomId).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "message",
      actorId: "scout",
      payload: { text: "PR 900 ready for review, @ash please take it" },
    });
    expect(broadcast).toHaveBeenCalledWith(
      "rooms.event",
      expect.objectContaining({ actorId: "scout" }),
      {
        dropIfSlow: true,
      },
    );
    expect(events.map((e) => e.kind)).not.toContain("turn.started");
  });

  it("refuses a Trunk that is not an enabled member, and a disabled member", async () => {
    const room = groupWith([{ id: "scout" }, { id: "ash", enabled: false }]);
    const outsider = await invoke(
      "rooms.trunk.post",
      { roomId: room.roomId, message: "hi" },
      "birch",
    );
    expect(firstResult(outsider.respond).message).toMatch(/not an enabled Trunk/);
    const disabled = await invoke(
      "rooms.trunk.post",
      { roomId: room.roomId, message: "hi" },
      "ash",
    );
    expect(firstResult(disabled.respond).ok).toBe(false);
    expect(readRoomLog(room.roomId).events).toHaveLength(0);
  });

  it("refuses a post that claims to be an outside agent", async () => {
    const room = groupWith([{ id: "scout" }]);
    const { respond } = await invoke(
      "rooms.trunk.post",
      { roomId: room.roomId, message: "hi", outsideAgent: { id: "x", name: "X" } },
      "scout",
    );
    expect(firstResult(respond)).toMatchObject({ ok: false });
    expect(readRoomLog(room.roomId).events).toHaveLength(0);
  });

  it("refuses archived rooms", async () => {
    const room = groupWith([{ id: "scout" }]);
    archiveRoom(room.roomId);
    const { respond } = await invoke(
      "rooms.trunk.post",
      { roomId: room.roomId, message: "hi" },
      "scout",
    );
    expect(firstResult(respond).message).toMatch(/Room not found/);
  });

  it("lists only the rooms the calling Trunk is an enabled member of", async () => {
    groupWith([{ id: "scout" }]);
    groupWith([{ id: "ash" }]);
    groupWith([{ id: "scout", enabled: false }, { id: "birch" }]);
    const { respond } = await invoke("rooms.trunk.list", {}, "scout");
    const rooms = firstResult(respond).payload?.rooms as { members: string[] }[];
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.members).toEqual(["trunk:scout"]);
  });

  it("reads the room log from a cursor for a member only", async () => {
    const room = groupWith([{ id: "scout" }, { id: "ash" }]);
    await invoke("rooms.trunk.post", { roomId: room.roomId, message: "one" }, "scout");
    await invoke("rooms.trunk.post", { roomId: room.roomId, message: "two" }, "ash");
    const member = await invoke("rooms.trunk.read", { roomId: room.roomId, cursor: 1 }, "ash");
    const log = firstResult(member.respond).payload as { events: { payload: { text: string } }[] };
    expect(log.events.map((e) => e.payload.text)).toEqual(["two"]);
    const outsider = await invoke("rooms.trunk.read", { roomId: room.roomId }, "birch");
    expect(firstResult(outsider.respond).ok).toBe(false);
  });
});
