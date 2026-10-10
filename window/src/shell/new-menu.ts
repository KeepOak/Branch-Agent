// The one New menu (DESIGN-SPEC §4.1.4, audit DA-02): New conversation and New Trunk, nothing else.
// New Trunk asks how to start: blank, or from a job in Customize. Each row runs its action and closes the menu.
import type { MenuItem } from "./Menu";

type Ctx = { newWith: (agentId: string) => void; trunks: { id: string; name: string }[]; defaultId: string | null; newTrunk: () => void; fromJob: () => void };

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
    { kind: "sub", label: "New Trunk", testid: "new-trunk", items: [
      { label: "Blank", run: c.newTrunk, testid: "new-trunk-blank" },
      { label: "From a job…", run: c.fromJob, testid: "new-trunk-job" },
    ] },
  ];
}
