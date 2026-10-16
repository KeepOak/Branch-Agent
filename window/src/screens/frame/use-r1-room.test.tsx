// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import type { Conversation } from "../../connect/conversations";
import type { ShellRoom } from "../../rooms/useShellRoom";
import { useR1Room } from "./use-r1-room";

vi.mock("../../rooms/RoomFaces", async (real) => ({ ...(await real<object>()), RoomFaces: ({ picks }: { picks: { name: string }[] }) => <span data-testid="faces">{picks.map((p) => p.name).join("+")}</span> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const answers: Record<string, unknown> = {
  "agents.list": { defaultId: "ledger", agents: [{ id: "ledger", name: "Ledger", identity: { name: "Ledger" } }, { id: "scout", name: "Scout", identity: { name: "Scout" } }] },
  "users.self": { profile: { id: "p-me" } },
  "users.list": { profiles: [{ id: "p-dana", displayName: "Dana" }] },
  "rooms.list": { rooms: [{ roomId: "grp1", name: "Month-end", rule: "lead", createdAt: 1, members: [{ kind: "trunk", id: "ledger" }, { kind: "trunk", id: "scout" }, { kind: "person", id: "p-dana" }] }] },
  "a2a.peers.list": { peers: [] },
};
function fakeSession(key: string): SaplingSession {
  const request = vi.fn(async (method: string) => answers[method] ?? {});
  return { request, onGatewayEvent: () => () => undefined, engine: { sessionKey: key, agentId: "ledger", request, onEvent: () => () => undefined, scopes: [] } } as unknown as SaplingSession;
}
const row = (key: string): Conversation => ({ key, title: "Month-end", agentId: "ledger", isMain: false, pinned: false, archived: false, unread: false, snoozedUntil: null, createdAt: 1, updatedAt: 1, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0 });

let seen: ShellRoom | null = null;
function Probe({ session, keyName }: { session: SaplingSession; keyName: string }) {
  const room = useR1Room(session, true, keyName, row(keyName), "Ledger", []);
  seen = room;
  return room.header ? <>{room.header.faces(24)}</> : null;
}
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

it("turns a Branch group chat into a room: members line, stacked faces, room placeholder and the other Trunks", async () => {
  const key = "agent:ledger:room:grp1";
  await act(async () => root.render(<Probe session={fakeSession(key)} keyName={key} />));
  await flush(); await flush();
  expect(seen?.thread.isRoom).toBe(true);
  expect(seen?.placeholder).toBe("Message the group · @ to call a Trunk");
  expect(seen?.header?.line).toBe("Ledger, Scout, Dana and you");
  expect(seen?.others).toEqual(["Scout"]);
  expect(seen?.menu?.ruleWords).toBe("lead decides");
  expect(host.querySelector("[data-testid='faces']")?.textContent).toBe("Ledger+Scout");
});

it("leaves a one-to-one conversation as it is", async () => {
  const key = "agent:ledger:t1";
  await act(async () => root.render(<Probe session={fakeSession(key)} keyName={key} />));
  await flush(); await flush();
  expect(seen?.thread.isRoom).toBe(false);
  expect(seen?.placeholder).toBeUndefined();
  expect(seen?.header).toBeNull();
  expect(host.querySelector("[data-testid='faces']")).toBeNull();
});
