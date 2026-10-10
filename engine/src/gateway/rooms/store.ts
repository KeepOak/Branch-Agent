import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
} from "../../state/branch-state-db.js";

// Storage and page budgets follow Hermes hosted_rooms.py @ 18d125cc.
const MAX_ACTIVE_ROOMS = 256;
const MAX_EVENTS_PER_ROOM = 50_000;
const MAX_EVENT_JSON_BYTES = 256 * 1024;
const MAX_LOG_LIMIT = 500;
const MAX_LOG_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_ROOM_EVENT_BYTES = 256 * 1024 * 1024;
const MAX_GATEWAY_EVENT_BYTES = 16 * 1024 * 1024;
// Rooms take any number of Trunks (owner decision; copy-upstream exception, Private PR #15).
// This total only protects the store. Room turns still run one at a time in member order,
// and every run stays under the host's agents.defaults.maxConcurrent lane.
const MAX_ROOM_MEMBERS = 500;

export type RoomMember = {
  roomId: string;
  kind: "trunk" | "person" | "a2a";
  id: string;
  order: number;
  role: "lead" | "member";
  enabled: boolean;
};
export type Room = {
  roomId: string;
  name: string;
  createdAt: number;
  lead?: string;
  rule: "lead" | "everyone" | "mentions";
  trunksTalk: boolean;
  memoryScope: "room";
  pinnedAt?: number;
  archivedAt?: number;
  members: RoomMember[];
};
export type RoomEvent = {
  roomId: string;
  seq: number;
  eventId: string;
  kind: string;
  actorId: string;
  payload: unknown;
  createdAt: number;
};
type RoomRow = {
  room_id: string;
  name: string;
  created_at: number;
  lead: string | null;
  rule: Room["rule"];
  trunks_talk: number;
  memory_scope: "room";
  pinned_at: number | null;
  archived_at: number | null;
};
type MemberRow = {
  room_id: string;
  kind: RoomMember["kind"];
  id: string;
  member_order: number;
  role: RoomMember["role"];
  enabled: number;
};
type EventRow = {
  room_id: string;
  seq: number;
  event_id: string;
  kind: string;
  actor_id: string;
  payload_json: string;
  created_at: number;
};
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const requireText = (value: string, label: string, max: number) => {
  if (!value.trim() || value !== value.trim() || value.length > max)
    throw new Error(`Invalid ${label}`);
  return value;
};
const readMembers = (db: DatabaseSync, roomId: string): RoomMember[] =>
  (
    db
      .prepare("SELECT * FROM room_members WHERE room_id=? ORDER BY member_order, kind, id")
      .all(roomId) as MemberRow[]
  ).map((row) => ({
    roomId: row.room_id,
    kind: row.kind,
    id: row.id,
    order: row.member_order,
    role: row.role,
    enabled: !!row.enabled,
  }));
const mapRoom = (db: DatabaseSync, row: RoomRow): Room => ({
  roomId: row.room_id,
  name: row.name,
  createdAt: row.created_at,
  ...(row.lead ? { lead: row.lead } : {}),
  rule: row.rule,
  trunksTalk: !!row.trunks_talk,
  memoryScope: row.memory_scope,
  ...(row.pinned_at !== null ? { pinnedAt: row.pinned_at } : {}),
  ...(row.archived_at !== null ? { archivedAt: row.archived_at } : {}),
  members: readMembers(db, row.room_id),
});
const roomRow = (db: DatabaseSync, roomId: string) =>
  db.prepare("SELECT * FROM rooms WHERE room_id=?").get(roomId) as RoomRow | undefined;
const activeRoom = (db: DatabaseSync, roomId: string) => {
  const row = roomRow(db, roomId);
  if (!row || row.archived_at !== null) throw new Error("Room not found");
  return row;
};
export function getRoom(roomId: string): Room | undefined {
  const db = openBranchStateDatabase().db;
  const row = roomRow(db, roomId);
  return row && mapRoom(db, row);
}
export function listRooms(includeArchived = false, limit = 500): Room[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error("Invalid room list limit");
  const db = openBranchStateDatabase().db;
  return (
    db
      .prepare(
        "SELECT * FROM rooms WHERE (?=1 OR archived_at IS NULL) ORDER BY created_at DESC, room_id LIMIT ?",
      )
      .all(includeArchived ? 1 : 0, limit) as RoomRow[]
  ).map((row) => mapRoom(db, row));
}
export function createRoom(input: {
  name: string;
  members: Omit<RoomMember, "roomId" | "order">[];
  rule?: Room["rule"];
  trunksTalk?: boolean;
  roomId?: string;
}): Room {
  requireText(input.name, "room name", 200);
  const trunks = input.members.filter((member) => member.kind === "trunk");
  if (trunks.length < 1 || new Set(trunks.map((member) => member.id)).size !== trunks.length)
    throw new Error("Rooms require at least one Trunk, each listed once");
  if (input.members.length > MAX_ROOM_MEMBERS) throw new Error("Too many room members");
  const lead = trunks.find((member) => member.role === "lead")?.id ?? trunks[0]!.id;
  if (
    trunks.filter((member) => member.role === "lead").length > 1 ||
    input.members.some(
      (member) => member.role === "lead" && (member.kind !== "trunk" || member.id !== lead),
    )
  )
    throw new Error("Invalid room lead");
  const roomId = requireText(input.roomId ?? randomUUID(), "room id", 128);
  const now = Date.now();
  return runBranchStateWriteTransaction(
    ({ db }) => {
      const count = (
        db.prepare("SELECT count(*) AS count FROM rooms WHERE archived_at IS NULL").get() as {
          count: number;
        }
      ).count;
      if (count >= MAX_ACTIVE_ROOMS) throw new Error("Too many active rooms");
      db.prepare(
        "INSERT INTO rooms(room_id,name,created_at,lead,rule,trunks_talk,memory_scope) VALUES (?,?,?,?,?,?, 'room')",
      ).run(roomId, input.name, now, lead, input.rule ?? "lead", input.trunksTalk ? 1 : 0);
      input.members.forEach((member, order) =>
        db
          .prepare(
            "INSERT INTO room_members(room_id,kind,id,member_order,role,enabled) VALUES (?,?,?,?,?,?)",
          )
          .run(
            roomId,
            member.kind,
            requireText(member.id, "member id", 128),
            order,
            member.id === lead && member.kind === "trunk" ? "lead" : "member",
            member.enabled ? 1 : 0,
          ),
      );
      return mapRoom(db, activeRoom(db, roomId));
    },
    {},
    { operationLabel: "rooms.create" },
  );
}
export function addRoomMember(roomId: string, member: Pick<RoomMember, "kind" | "id">): Room {
  return runBranchStateWriteTransaction(
    ({ db }) => {
      activeRoom(db, roomId);
      const members = readMembers(db, roomId);
      if (members.some((row) => row.kind === member.kind && row.id === member.id))
        throw new Error("Member already exists");
      if (members.length >= MAX_ROOM_MEMBERS) throw new Error("Too many room members");
      db.prepare(
        "INSERT INTO room_members(room_id,kind,id,member_order,role,enabled) VALUES (?,?,?,?,'member',1)",
      ).run(roomId, member.kind, requireText(member.id, "member id", 128), members.length);
      return mapRoom(db, activeRoom(db, roomId));
    },
    {},
    { operationLabel: "rooms.members.add" },
  );
}
export function removeRoomMember(roomId: string, kind: RoomMember["kind"], id: string): Room {
  return runBranchStateWriteTransaction(
    ({ db }) => {
      const room = activeRoom(db, roomId);
      if (room.lead === id && kind === "trunk") throw new Error("Cannot remove the lead Trunk");
      const result = db
        .prepare("DELETE FROM room_members WHERE room_id=? AND kind=? AND id=?")
        .run(roomId, kind, id);
      if (!result.changes) throw new Error("Member not found");
      return mapRoom(db, room);
    },
    {},
    { operationLabel: "rooms.members.remove" },
  );
}
export function setRoomRule(roomId: string, rule: Room["rule"], trunksTalk: boolean): Room {
  return runBranchStateWriteTransaction(
    ({ db }) => {
      activeRoom(db, roomId);
      db.prepare("UPDATE rooms SET rule=?, trunks_talk=? WHERE room_id=?").run(
        rule,
        trunksTalk ? 1 : 0,
        roomId,
      );
      return mapRoom(db, activeRoom(db, roomId));
    },
    {},
    { operationLabel: "rooms.rule.set" },
  );
}

/** Disconnect removes membership even in archived rooms, so restoring a room cannot restore access. */
export function removeOutsideRoomMembers(ids: readonly string[]): Room[] {
  if (!ids.length) {
    return [];
  }
  return runBranchStateWriteTransaction(
    ({ db }) => {
      const affected = new Set<string>();
      const find = db.prepare("SELECT room_id FROM room_members WHERE kind='a2a' AND id=?");
      const remove = db.prepare("DELETE FROM room_members WHERE kind='a2a' AND id=?");
      for (const id of ids) {
        for (const row of find.all(id) as Array<{ room_id: string }>) {
          affected.add(row.room_id);
        }
        remove.run(id);
      }
      return [...affected].map((roomId) => mapRoom(db, roomRow(db, roomId)!));
    },
    {},
    { operationLabel: "rooms.members.disconnect" },
  );
}
export function archiveRoom(roomId: string): Room {
  return runBranchStateWriteTransaction(
    ({ db }) => {
      db.prepare("UPDATE rooms SET archived_at=coalesce(archived_at, ?) WHERE room_id=?").run(
        Date.now(),
        roomId,
      );
      const row = roomRow(db, roomId);
      if (!row) throw new Error("Room not found");
      return mapRoom(db, row);
    },
    {},
    { operationLabel: "rooms.archive" },
  );
}
export function appendRoomEvent(
  roomId: string,
  kind: string,
  actorId: string,
  payload: unknown,
  eventId: string = randomUUID(),
): RoomEvent {
  requireText(kind, "event kind", 64);
  requireText(actorId, "actor id", 128);
  requireText(eventId, "event id", 128);
  const json = JSON.stringify(payload);
  if (!json || bytes(json) > MAX_EVENT_JSON_BYTES)
    throw new Error("Room event exceeds payload limit");
  return runBranchStateWriteTransaction(
    ({ db }) => {
      activeRoom(db, roomId);
      const usage = db
        .prepare(
          "SELECT count(*) AS count, coalesce(sum(length(payload_json)),0) AS bytes FROM room_events WHERE room_id=?",
        )
        .get(roomId) as { count: number; bytes: number };
      if (usage.count >= MAX_EVENTS_PER_ROOM || usage.bytes + bytes(json) > MAX_ROOM_EVENT_BYTES)
        throw new Error("Room history limit reached");
      const gateway = (
        db
          .prepare("SELECT coalesce(sum(length(payload_json)),0) AS bytes FROM room_events")
          .get() as { bytes: number }
      ).bytes;
      if (gateway + bytes(json) > MAX_GATEWAY_EVENT_BYTES)
        throw new Error("Gateway room history limit reached");
      const seq = usage.count + 1,
        createdAt = Date.now();
      db.prepare(
        "INSERT INTO room_events(room_id,seq,event_id,kind,actor_id,payload_json,created_at) VALUES (?,?,?,?,?,?,?)",
      ).run(roomId, seq, eventId, kind, actorId, json, createdAt);
      return { roomId, seq, eventId, kind, actorId, payload, createdAt };
    },
    {},
    { operationLabel: "rooms.event" },
  );
}
export function readRoomLog(
  roomId: string,
  cursor = 0,
  limit = MAX_LOG_LIMIT,
): { events: RoomEvent[]; nextCursor?: number } {
  if (
    !Number.isInteger(cursor) ||
    cursor < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LOG_LIMIT
  )
    throw new Error("Invalid room log cursor or limit");
  const db = openBranchStateDatabase().db;
  if (!roomRow(db, roomId)) throw new Error("Room not found");
  const rows = db
    .prepare("SELECT * FROM room_events WHERE room_id=? AND seq>? ORDER BY seq LIMIT ?")
    .all(roomId, cursor, limit + 1) as EventRow[];
  const events: RoomEvent[] = [];
  let pageBytes = 0;
  for (const row of rows.slice(0, limit)) {
    const size = bytes(row.payload_json);
    if (events.length && pageBytes + size > MAX_LOG_PAGE_BYTES) break;
    pageBytes += size;
    events.push({
      roomId,
      seq: row.seq,
      eventId: row.event_id,
      kind: row.kind,
      actorId: row.actor_id,
      payload: JSON.parse(row.payload_json),
      createdAt: row.created_at,
    });
  }
  return { events, ...(rows.length > events.length ? { nextCursor: events.at(-1)?.seq } : {}) };
}
