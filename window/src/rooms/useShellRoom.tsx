// What the window shell hands the thread, composer, header, ⋯ menu and agent window for the open conversation
// when it is a room (DESIGN-SPEC §4.2.4). One hook, so the shell's own files only pass these props along.
import { useMemo, type ReactNode } from "react";
import type { WindowEngine } from "../connect/engine";
import type { MenuItem } from "../shell/Menu";
import { notify } from "../shell/notify";
import type { Block } from "../thread/model";
import { RoomFaces, roomPicks } from "./RoomFaces";
import { roomRulesItems, ruleToast } from "./room-rules";
import type { ThreadRoom } from "./thread-room";
import { RULE_WORDS, useRoom } from "./useRoom";

/** The composer's placeholder in a room (§4.3.1). */
export const ROOM_PLACEHOLDER = "Message the room · @ to call a Trunk";

export type ShellRoom = {
  thread: ThreadRoom;
  /** Only in a room: */
  placeholder?: string;
  header: { faces: (size: number) => ReactNode; line: string } | null;
  menu: { ruleWords: string | null; rules: () => MenuItem[] } | null;
  /** The other Trunks in the room, for the agent window. */
  others: string[];
  members: string[];
};

type Args = {
  engine: WindowEngine | undefined;
  rowKind: string | undefined;
  agentId: string | undefined;
  title: string;
  ownTrunk: string;
  history: readonly Block[];
  trunks: readonly { id: string; name: string }[];
};

export function useShellRoom(a: Args): ShellRoom {
  const room = useRoom(a.engine, a.rowKind, a.history);
  const trunkName = useMemo(() => (id: string) => a.trunks.find((t) => t.id === id)?.name || id, [a.trunks]);
  const thread: ThreadRoom = { isRoom: room.isRoom, selfId: room.selfId, ownAgentId: a.agentId ?? room.ownAgentId, trunkName, whereRuns: room.whereRuns, isOnline: room.isOnline };
  if (!room.isRoom) return { thread, header: null, menu: null, others: [], members: [] };
  const picks = roomPicks(a.ownTrunk, room.members, trunkName);
  const choose = (rule: "mention" | "always") =>
    void room.setRule(rule).then(
      () => notify(ruleToast(rule, a.title)),
      (e: unknown) => notify(e instanceof Error ? e.message : String(e), { tone: "bad" }),
    );
  return {
    thread,
    placeholder: ROOM_PLACEHOLDER,
    // A room keeps its stacked members in the narrow header too, at 34 px, not the 56 px living figure (§4.2.1).
    header: { faces: (size) => <RoomFaces picks={picks} size={Math.min(size, 34)} />, line: room.line(a.ownTrunk, trunkName) },
    menu: { ruleWords: room.rule ? RULE_WORDS[room.rule] : null, rules: () => roomRulesItems({ chatApp: room.chatApp, rule: room.rule, choose }) },
    others: room.members.trunks.map(trunkName).filter((n) => n !== a.ownTrunk),
    members: [a.ownTrunk, ...room.members.trunks.map(trunkName), ...room.members.people.map((member) => member.name), ...room.members.agents.map((member) => member.name)].filter((name, index, all) => Boolean(name) && all.indexOf(name) === index),
  };
}
