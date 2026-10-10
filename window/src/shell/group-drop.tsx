import { useEffect, useRef, useState } from "react";
import type { Contact as GatewayContact } from "@branch/gateway-protocol";
import type { SaplingSession } from "../connect/session";
import type { Block } from "../thread/model";
import type { RoomPick } from "../rooms/RoomFaces";
import { RoomFaces } from "../rooms/RoomFaces";
import { openNewGroupChat } from "../rooms/NewGroupChat";
import type { SidebarDrop } from "./sidebar-drag";
import "./group-drop.css";

export type GroupMember = { kind: "trunk" | "person" | "a2a"; id: string; role?: "lead" | "member" };
export type GroupRoom = { roomId: string; name: string; lead?: string; rule?: "lead" | "everyone" | "mentions"; createdAt: number; archivedAt?: number; members: GroupMember[] };
export type GroupContact = GatewayContact & { roomId?: string; offline?: boolean; roomPicks?: RoomPick[] };
export type GroupDrop = { kind: "new" | "add" | "pick"; source: string; target?: string; roomId?: string; anchor: DOMRect };

export const memberOf = (contact: GroupContact): GroupMember | null => contact.kind === "trunk"
  ? { kind: "trunk", id: contact.id.slice(6) }
  : contact.kind === "outside" ? { kind: "a2a", id: contact.id.slice(4) } : null;
export const hasMember = (room: GroupRoom, contact: GroupContact) => {
  const member = memberOf(contact);
  return Boolean(member && room.members.some((row) => row.kind === member.kind && row.id === member.id));
};
export function groupPlan(drop: SidebarDrop, contacts: readonly GroupContact[], rooms: readonly GroupRoom[]): GroupDrop["kind"] | "duplicate" | null {
  const source = contacts.find((c) => c.threadKey === drop.source);
  const target = contacts.find((c) => c.threadKey === drop.target);
  if (!source || !target || source === target) return null;
  const room = rooms.find((r) => r.roomId === (target.roomId ?? source.roomId));
  const person = target.roomId ? source : target;
  if (source.roomId && target.roomId) return null;
  if (room) return !memberOf(person) ? null : hasMember(room, person) ? "duplicate" : "add";
  return memberOf(source) && memberOf(target) ? "new" : null;
}

export function groupHint(drop: SidebarDrop, contacts: readonly GroupContact[], rooms: readonly GroupRoom[]): string {
  if (drop.zone !== "onto") return "Move here";
  const plan = groupPlan(drop, contacts, rooms);
  const source = contacts.find((c) => c.threadKey === drop.source);
  const target = contacts.find((c) => c.threadKey === drop.target);
  if (plan === "duplicate") return "Already in this group";
  if (plan === "new") return `Start a group with ${target?.name ?? ""}`;
  if (plan === "add") return `Add ${(target?.roomId ? source : target)?.name ?? ""} to ${(target?.roomId ? target : source)?.name ?? ""}`;
  return "";
}

export function useGroupRooms(session: SaplingSession, ready: boolean) {
  const [rooms, setRooms] = useState<GroupRoom[]>([]);
  const [peerOnline, setPeerOnline] = useState<Map<string, boolean>>(new Map());
  const reload = () => session.request<{ rooms: GroupRoom[] }>("rooms.list", {}).then((result) => setRooms(result.rooms), (error: unknown) => console.warn("rooms.list failed", error));
  const reloadPeers = () => session.request<{ peers: { name: string; online?: boolean }[] }>("a2a.peers.list", {}).then(
    (result) => setPeerOnline(new Map(result.peers.filter((peer) => typeof peer.online === "boolean").map((peer) => [peer.name, peer.online!]))),
    () => undefined,
  );
  useEffect(() => {
    if (!ready) { setRooms([]); setPeerOnline(new Map()); return; }
    void reload(); void reloadPeers();
    return session.onGatewayEvent((event) => { if (event === "rooms.changed") void reload(); else if (event === "contacts.changed") void reloadPeers(); });
  }, [session, ready]);
  return { rooms, peerOnline, reload };
}

export function roomContact(room: GroupRoom, contacts: readonly GatewayContact[] = []): GroupContact | null {
  if (!room.lead) return null;
  const roomPicks: RoomPick[] = room.members.slice(0, 2).map((member) => {
    const name = contacts.find((contact) => contact.id === `${member.kind === "a2a" ? "a2a" : "trunk"}:${member.id}`)?.name ?? member.id;
    return member.kind === "trunk" ? { kind: "trunk", name } : { kind: "person", id: member.id, name };
  });
  return {
    id: `room:${room.roomId}`, roomId: room.roomId, roomPicks, kind: "group", name: room.name,
    face: { members: room.members.map((member) => member.id) },
    threadKey: `agent:${room.lead}:room:${room.roomId}`, isDefault: false,
    ...(room.archivedAt ? { archivedAt: room.archivedAt } : {}),
    lastActivityAt: room.createdAt, preview: { kind: "message", text: "Group", at: room.createdAt },
    unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0,
  };
}

/** What the room's log adds to its lead conversation: notices, and the Trunks' posts and replies that live only there. */
const LOGGED = new Set(["created", "member.added", "message", "turn.replied"]);

export function useRoomNotices(session: SaplingSession, key: string | null, contacts: readonly GroupContact[]): Block[] {
  const [, lead, roomId] = /^agent:([^:]+):room:([^:]+)$/.exec(key ?? "") ?? [];
  const [events, setEvents] = useState<{ seq: number; kind: string; actorId?: string; payload: unknown; createdAt: number }[]>([]);
  useEffect(() => {
    if (!roomId) { setEvents([]); return; }
    let live = true;
    setEvents([]);
    const load = async () => {
      let cursor: number | undefined;
      const notices: typeof events = [];
      try {
        do {
          const page: { events: typeof events; nextCursor?: number } = await session.request("rooms.log", { roomId, ...(cursor ? { cursor } : {}) });
          if (!live) return;
          notices.push(...page.events.filter((event) => LOGGED.has(event.kind)));
          cursor = page.nextCursor;
        } while (cursor);
        setEvents((current) => [...notices, ...current.filter((row) => !notices.some((saved) => saved.seq === row.seq))].sort((a, b) => a.seq - b.seq));
      } catch { if (live) setEvents([]); }
    };
    void load();
    const off = session.onGatewayEvent((event, payload) => {
      const value = payload as { roomId?: string; seq?: number; kind?: string; actorId?: string; payload?: unknown; createdAt?: number };
      if (event === "rooms.event" && value?.roomId === roomId && typeof value.seq === "number" && LOGGED.has(value.kind ?? "")) {
        setEvents((current) => current.some((row) => row.seq === value.seq) ? current : [...current, { seq: value.seq!, kind: value.kind!, actorId: value.actorId, payload: value.payload, createdAt: value.createdAt ?? 0 }]);
      }
    });
    return () => { live = false; off(); };
  }, [session, roomId]);
  const named = (member: GroupMember) => contacts.find((contact) => {
    const current = memberOf(contact);
    return current?.kind === member.kind && current.id === member.id;
  })?.name ?? member.id;
  const isTrunk = (id: string | undefined) => Boolean(id) && (id === lead || contacts.some((contact) => contact.kind === "trunk" && memberOf(contact)?.id === id));
  return events.flatMap((event): Block[] => {
    const data = event.payload as { members?: GroupMember[]; kind?: GroupMember["kind"]; id?: string; from?: string; text?: string };
    // A Trunk's report to the room: its room_post ("message"), or the reply of a Trunk other than the lead (the lead's
    // own replies are already in this conversation). An owner's or outside agent's post is in it already too.
    const posted = event.kind === "message" || (event.kind === "turn.replied" && event.actorId !== lead);
    if (posted && isTrunk(event.actorId) && data.text?.trim()) {
      const sender = event.actorId === lead ? undefined : { kind: "trunk" as const, agentId: event.actorId!, posted: true };
      return [{ kind: "text", key: `room:${roomId}:${event.seq}`, text: data.text, streaming: false, meta: { timestamp: event.createdAt, ...(sender ? { sender } : {}) } }];
    }
    if (event.kind === "created") {
      const members = data.members ?? [];
      const shown = members.length > 2 ? members.slice(0, 2) : members;
      return [{ kind: "notice", key: `room:${roomId}:${event.seq}`, text: `You started a group with ${shown.map(named).join(" and ")}`, at: event.createdAt }];
    }
    if (event.kind === "member.added" && data.kind && data.id) return [{ kind: "notice", key: `room:${roomId}:${event.seq}`, text: `${event.actorId?.startsWith("a2a:") ? (data.from ?? event.actorId.slice(4)) : "You"} added ${named({ kind: data.kind, id: data.id })}`, at: event.createdAt }];
    return [];
  });
}

/** Keep untimed blocks attached to their preceding message while placing room events by recorded time. */
export function mergeRoomNotices(history: readonly Block[], notices: readonly Block[]): Block[] {
  const noticeAt = (block: Block) => block.kind === "notice" ? block.at ?? 0 : block.kind === "text" ? block.meta?.timestamp ?? 0 : 0;
  const ordered = [...notices].sort((a, b) => noticeAt(a) - noticeAt(b));
  const merged: Block[] = [];
  let next = 0;
  for (const block of history) {
    const at = block.kind === "user" || block.kind === "text" ? block.meta?.timestamp : undefined;
    if (at !== undefined) while (next < ordered.length && noticeAt(ordered[next]!) <= at) merged.push(ordered[next++]!);
    merged.push(block);
  }
  return [...merged, ...ordered.slice(next)];
}

export async function createDroppedGroup(session: SaplingSession, contacts: readonly GroupContact[], ids: readonly string[], name: string, defaultTrunk: string): Promise<GroupRoom> {
  const picked = ids.map((id) => contacts.find((c) => c.threadKey === id)).filter((c): c is GroupContact => Boolean(c));
  const members = picked.map(memberOf).filter((m): m is GroupMember => Boolean(m));
  const unique = members.filter((member, i) => members.findIndex((other) => other.kind === member.kind && other.id === member.id) === i);
  if (unique.length !== 2) throw new Error("Pick two different contacts.");
  if (!unique.some((member) => member.kind === "trunk")) unique.push({ kind: "trunk", id: defaultTrunk });
  const lead = unique.find((member) => member.kind === "trunk")!;
  const result = await session.request<{ room: GroupRoom }>("rooms.create", { name: name.trim() || picked.map((contact) => contact.name).join(" and "), members: unique.map((member) => ({ ...member, role: member === lead ? "lead" : "member" })) });
  return result.room;
}

export async function moveContactToProject(session: SaplingSession, sessionKey: string, projectId: string): Promise<void> {
  await session.request("sessions.patch", { key: sessionKey, projectId });
}

export function GroupDropPopover({ drop, contacts, rooms, defaultTrunk, session, onClose, onOpen, onPick }: {
  drop: GroupDrop; contacts: readonly GroupContact[]; rooms: readonly GroupRoom[]; defaultTrunk: string;
  session: SaplingSession; onClose: () => void; onOpen: (key: string) => void; onPick?: (drop: GroupDrop) => void;
}) {
  const source = contacts.find((c) => c.threadKey === drop.source);
  const target = contacts.find((c) => c.threadKey === drop.target);
  const room = rooms.find((r) => r.roomId === drop.roomId || r.roomId === target?.roomId || r.roomId === source?.roomId);
  const person = target?.roomId || (drop.kind === "add" && !target) ? source : target;
  const ids = [drop.source, drop.target].filter((id): id is string => Boolean(id));
  const names = ids.map((id) => contacts.find((c) => c.threadKey === id)?.name ?? "");
  const [name, setName] = useState(names.join(" and "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const starting = useRef(false);
  const added = useRef(new Set<string>());
  useEffect(() => { (input.current ?? ref.current?.querySelector<HTMLButtonElement>("button"))?.focus(); input.current?.select(); }, [drop]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-drag-key="${CSS.escape(drop.source)}"] .pin-open, [data-drag-key="${CSS.escape(drop.source)}"] .row-open`)?.focus({ preventScroll: true })); } };
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener("keydown", key, true); document.addEventListener("pointerdown", away, true);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", away, true); };
  }, [onClose, drop.source]);
  const add = async (to: GroupRoom, who: GroupContact[]) => {
    if (starting.current) return;
    starting.current = true;
    setBusy(true); setError("");
    try {
      for (const contact of who) {
        if (hasMember(to, contact) || added.current.has(contact.id)) continue;
        const member = memberOf(contact);
        if (member) { await session.request("rooms.members.add", { roomId: to.roomId, ...member }); added.current.add(contact.id); }
      }
      onClose(); onOpen(`agent:${to.lead}:room:${to.roomId}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); setBusy(false); }
    finally { starting.current = false; }
  };
  const create = async (a: string, b: string) => {
    if (starting.current) return;
    starting.current = true;
    setBusy(true); setError("");
    try {
      const made = await createDroppedGroup(session, contacts, [a, b], name || names.join(" and "), defaultTrunk);
      onClose(); onOpen(`agent:${made.lead}:room:${made.roomId}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); setBusy(false); }
    finally { starting.current = false; }
  };
  const rect = drop.anchor;
  const people = contacts.filter((candidate) => !candidate.roomId && candidate.threadKey !== drop.source && memberOf(candidate) && !candidate.archivedAt);
  return <div ref={ref} id="group-drop-popover" className="pop group-drop-popover" role="dialog" aria-label={drop.kind === "add" ? "Add to group" : drop.kind === "pick" ? "Move to group" : "New group"}
    style={{ left: Math.max(8, Math.min(rect.left, innerWidth - 300)), top: Math.max(8, Math.min(rect.bottom + 6, innerHeight - 390)) }}>
    {drop.kind === "pick" ? <>
      {rooms.length ? <><div className="ph">Add {source?.name} to</div>{rooms.map((candidate) => <button key={candidate.roomId} type="button" className="mi" disabled={busy || !source || hasMember(candidate, source)} onClick={() => onPick?.({ kind: "add", source: drop.source, roomId: candidate.roomId, anchor: rect })}>{candidate.name}{source && hasMember(candidate, source) ? " · Already in this group" : ""}</button>)}<hr /></> : null}
      {people.length ? <><div className="ph">Start a group with</div>{people.map((candidate) => <button key={candidate.id} type="button" className="mi" onClick={() => onPick?.({ kind: "new", source: drop.source, target: candidate.threadKey, anchor: rect })}>{candidate.name}</button>)}</> : null}
      {!rooms.length && !people.length ? <><p className="group-drop-empty">Nobody to start a group with.</p><button type="button" className="mi" onClick={() => { onClose(); openNewGroupChat(); }}>New group chat…</button></> : null}
    </> : drop.kind === "add" && room && person ? <>
      <p className="group-drop-question">Add <b>{person.name}</b> to <b>{room.name}</b>?</p>
      {person.offline ? <p className="group-drop-note">{person.name} is offline. It joins when it’s back.</p> : null}
      <div className="group-drop-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn pri" disabled={busy} onClick={() => void add(room, [person])}>Add</button></div>
    </> : drop.kind === "new" && source && target ? <>
      <div className="group-drop-head"><RoomFaces picks={[source, target].map((contact) => contact.kind === "trunk" ? { kind: "trunk", name: contact.name } : { kind: "person", id: contact.id, name: contact.name })} size={28} /><b>New group</b></div>
      <label className="group-drop-field">Name <input ref={input} className="inp" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void create(drop.source, drop.target!); } }} /></label>
      <button type="button" className="btn pri" data-testid="start-group-with-these" disabled={busy || !name.trim()} onClick={() => void create(drop.source, drop.target!)}>New group with {source.name} and {target.name}</button>
      {[source, target].filter((c) => c.offline).map((c) => <p key={c.id} className="group-drop-note">{c.name} is offline. It joins when it’s back.</p>)}
      {rooms.length ? <><hr /><div className="ph">Add both to…</div>{rooms.map((candidate) => <button key={candidate.roomId} type="button" className="mi" disabled={busy || [source, target].every((c) => hasMember(candidate, c))} onClick={() => void add(candidate, [source, target])}>{candidate.name}{[source, target].every((c) => hasMember(candidate, c)) ? " · Already in this group" : ""}</button>)}</> : null}
      <hr /><button type="button" className="mi" onClick={onClose}>Cancel <kbd>Esc</kbd></button>
    </> : null}
    {error ? <p role="alert" className="group-drop-error">{error}</p> : null}
  </div>;
}
