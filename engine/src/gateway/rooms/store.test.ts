import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import {
  addRoomMember,
  appendRoomEvent,
  archiveRoom,
  createRoom,
  getRoom,
  listRooms,
  readRoomLog,
  removeRoomMember,
  setRoomRule,
} from "./store.js";

describe("rooms store", () => {
  let directory: string;
  let previous: string | undefined;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "branch-rooms-"));
    previous = process.env.BRANCH_STATE_DIR;
    process.env.BRANCH_STATE_DIR = directory;
  });
  afterEach(() => {
    closeBranchStateDatabaseForTest();
    if (previous === undefined) delete process.env.BRANCH_STATE_DIR;
    else process.env.BRANCH_STATE_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });

  it("round-trips a room, members, rule, archive and append-only event cursor", () => {
    const room = createRoom({
      name: "Design",
      members: [{ kind: "trunk", id: "scout", role: "lead", enabled: true }],
    });
    expect(room).toMatchObject({
      name: "Design",
      lead: "scout",
      rule: "lead",
      memoryScope: "room",
    });
    expect(getRoom(room.roomId)).toEqual(room);
    expect(listRooms()).toEqual([room]);
    expect(addRoomMember(room.roomId, { kind: "trunk", id: "ledger" }).members).toHaveLength(2);
    expect(removeRoomMember(room.roomId, "trunk", "ledger").members).toHaveLength(1);
    expect(setRoomRule(room.roomId, "mentions", true)).toMatchObject({
      rule: "mentions",
      trunksTalk: true,
    });
    const first = appendRoomEvent(room.roomId, "message", "owner", { text: "Hello" });
    const second = appendRoomEvent(room.roomId, "turn.started", "scout", {
      sessionKey: `agent:scout:room:${room.roomId}`,
    });
    expect(readRoomLog(room.roomId, 0, 1)).toEqual({ events: [first], nextCursor: first.seq });
    expect(readRoomLog(room.roomId, first.seq)).toEqual({ events: [second] });
    expect(archiveRoom(room.roomId).archivedAt).toBeGreaterThan(0);
    expect(listRooms()).toEqual([]);
    expect(listRooms(true)).toHaveLength(1);
    expect(() => appendRoomEvent(room.roomId, "message", "owner", {})).toThrow("Room not found");
  });

  it("enforces the source's six-Trunk cap and bounded event payload", () => {
    const members = Array.from({ length: 6 }, (_, index) => ({
      kind: "trunk" as const,
      id: `agent-${index}`,
      role: "member" as const,
      enabled: true,
    }));
    const room = createRoom({ name: "Six", members });
    expect(() => addRoomMember(room.roomId, { kind: "trunk", id: "seventh" })).toThrow(
      "Too many room members",
    );
    expect(() =>
      appendRoomEvent(room.roomId, "message", "owner", { text: "x".repeat(256 * 1024) }),
    ).toThrow("payload limit");
  });
});
