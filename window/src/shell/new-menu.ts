// The + new menu (DESIGN-SPEC §4.1.4). Each row runs its action and closes the menu.
import type { PlaceId } from "../places-nav/routes";
import type { MenuItem } from "./Menu";
import { openNewGroupChat } from "../rooms/NewGroupChat";

type Ctx = { newWith: (agentId: string) => void; trunks: { id: string; name: string }[]; defaultId: string | null; newTrunk: () => void; newChiefOfStaff: () => void; openPlace: (p: PlaceId) => void; makeTrunk: () => void; quickAsk: () => void };

/** A contact's configured main key owns every new topic. The first send creates and titles it atomically. */
export async function createTopic(request: (method: string, params: unknown) => Promise<unknown>, agentId: string, mainKey: string, message: string, options: Record<string, unknown> = {}): Promise<string> {
  const first = message.trim();
  if (!first) throw new Error("Write a message to start the conversation.");
  const displayName = first.replace(/\s+/g, " ").slice(0, 100);
  const result = await request("sessions.create", {
    agentId, parentSessionKey: `agent:${agentId}:${mainKey}`, message: first,
    displayName, titleSource: first.slice(0, 1000), ...options,
  }) as { key?: unknown };
  if (typeof result.key !== "string" || !result.key) throw new Error("The engine made no conversation.");
  return result.key;
}

export function newMenuItems(c: Ctx): MenuItem[] {
  const trunks = [...c.trunks].sort((a, b) => Number(b.id === c.defaultId) - Number(a.id === c.defaultId));
  return [
    { kind: "sub", label: "New conversation", hint: "Ctrl N", testid: "new-conversation", items: trunks.map((trunk) => ({
      label: `with ${trunk.name}${trunk.id === c.defaultId ? " (default)" : ""}`,
      run: () => c.newWith(trunk.id), testid: `new-with-${trunk.id}`,
    })) },
    { label: "New Trunk", run: c.newTrunk, testid: "new-trunk" },
    { label: "Chief of Staff Trunk", run: c.newChiefOfStaff, testid: "new-chief-of-staff" },
    { label: "New group chat", hint: "people, Trunks, agents", run: openNewGroupChat, testid: "new-group-chat" },
    { label: "New automation", run: () => c.openPlace("automations"), testid: "new-automation" },
    { label: "A Trunk from a job…", run: () => c.openPlace("customize") },
    { label: "Have Branch make a Trunk", run: c.makeTrunk, testid: "new-make-trunk" },
    { label: "Quick ask", hint: "Ctrl Shift Space", run: c.quickAsk, testid: "new-quick-ask" },
  ];
}
