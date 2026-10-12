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

  it("takes any number of Trunks up to the store's 500-member total and bounds event payloads", () => {
    const trunk = (id: string) => ({
      kind: "trunk" as const,
      id,
      role: "member" as const,
      enabled: true,
    });
    const room = createRoom({
      name: "Twenty",
      members: Array.from({ length: 20 }, (_, index) => trunk(`agent-${index}`)),
    });
    expect(room.members.filter((member) => member.kind === "trunk")).toHaveLength(20);
    expect(addRoomMember(room.roomId, { kind: "trunk", id: "agent-20" }).members).toHaveLength(21);
    expect(() =>
      createRoom({ name: "Twice", members: [trunk("agent-0"), trunk("agent-0")] }),
    ).toThrow("each listed once");
    const full = createRoom({
      name: "Full",
      members: Array.from({ length: 500 }, (_, index) => trunk(`full-${index}`)),
    });
    expect(() => addRoomMember(full.roomId, { kind: "trunk", id: "full-500" })).toThrow(
      "Too many room members",
    );
    expect(() =>
      createRoom({
        name: "Over",
        members: Array.from({ length: 501 }, (_, index) => trunk(`over-${index}`)),
      }),
    ).toThrow("Too many room members");
    expect(() =>
      appendRoomEvent(room.roomId, "message", "owner", { text: "x".repeat(256 * 1024) }),
    ).toThrow("payload limit");
  });
});
