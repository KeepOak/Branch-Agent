// The open conversation as a room in the R1 window: the Classic hook (rooms/useShellRoom) fed the way the Classic
// window feeds it, from the Trunks list, the people list and the Branch group chats. The thread gets its fold and
// sender rows, the header pill its stacked faces, and the composer its room placeholder.
import type { Conversation } from "../../connect/conversations";
import { roomIdOf, type SaplingSession } from "../../connect/session";
import { useShellRoom, type ShellRoom } from "../../rooms/useShellRoom";
import { useListPeople, useTrunks, type Trunks } from "../../shell/engine-data";
import { useGroupRooms } from "../../shell/group-drop";
import type { Block } from "../../thread/model";

/** `known`: the Trunks list the window already reads; without it the hook reads its own. */
export function useR1Room(session: SaplingSession, ready: boolean, key: string | null, row: Conversation | null, name: string, history: readonly Block[], known?: Trunks): ShellRoom {
  const own = useTrunks(session, ready && !known);
  const trunks = known ?? own;
  const people = useListPeople(session, ready);
  const groups = useGroupRooms(session, ready);
  const roomId = roomIdOf(key ?? "");
  const trunkName = (id: string | undefined) => (id ? trunks.list.find((trunk) => trunk.id === id)?.name : undefined);
  return useShellRoom({
    engine: ready ? session.engine : undefined, rowKind: row?.kind, agentId: row?.agentId, title: name, ownTrunk: trunkName(row?.agentId) ?? name,
    history, trunks: trunks.list,
    groupRoom: roomId && Array.isArray(groups.rooms) ? groups.rooms.find((candidate) => candidate.roomId === roomId) : undefined,
    memberName: (kind, id) => (kind === "person" ? people.names.get(id) ?? id : trunkName(id) ?? id),
  });
}
