// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { ThreadRoom } from "../../rooms/thread-room";
import { historyToBlocks } from "../../thread/history";
import { layout } from "../../thread/layout";
import { foldTalks } from "../../rooms/fold";
import { ChatView } from "./ChatView";
import { roomEntries } from "./room-entries";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-face={label} /> }));
vi.mock("../../composer/useConversation", () => ({ useConversation: () => ({ loaded: false }), hasNoModel: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const engine = { request: vi.fn(async () => ({})), onEvent: () => () => undefined, sessionKey: "agent:ledger:grp", agentId: "ledger", scopes: ["operator.admin"], features: { methods: ["chat.send"], events: [] } } as unknown as WindowEngine;
// Engine-shaped history, as the Classic room thread test reads it: a person, the Trunk's report, another Trunk forwarding
// in and this Trunk answering it, an outside agent, and the viewer's own message.
const messages = [
  { role: "user", content: "Can we close September today?", __branch: { senderIdentity: { type: "profile", id: "p-dana" }, senderId: "p-dana", senderName: "Dana" } },
  { role: "assistant", content: [{ type: "text", text: "Yes. 14 of 16 receipts match." }], stopReason: "stop", __branch: { runId: "r1" } },
  { role: "assistant", content: "@Ledger want me to pull the two missing receipts?", senderLabel: "Forwarded from scout", senderSession: { sessionKey: "agent:scout:main", agentId: "scout" } },
  { role: "assistant", content: [{ type: "text", text: "Yes please." }], stopReason: "stop", __branch: { runId: "r2" } },
  { role: "user", content: "No duplicates.", __branch: { senderId: "researcher", senderName: "researcher", senderIdentity: { type: "observation", id: "researcher", pluginId: "a2a", accountId: null, senderKind: "unknown" } } },
  { role: "user", content: "Thanks, all.", __branch: { senderIdentity: { type: "profile", id: "p-me" }, senderId: "p-me", senderName: "Me" } },
];
const names: Record<string, string> = { ledger: "Ledger", scout: "Scout" };
const room = (isRoom: boolean): ThreadRoom => ({ isRoom, selfId: "p-me", ownAgentId: "ledger", trunkName: (id) => names[id] ?? id, whereRuns: (peer) => (peer === "researcher" ? "agents.example.net" : null) });
const history = historyToBlocks(messages, [], "agent:ledger:grp", null);
const show = (r?: ThreadRoom) => act(async () => root.render(<ChatView name="Ledger" history={history} live={[]} pendingUser={null} running={false} engine={engine} sessionKey="agent:ledger:grp" onAnswer={() => undefined} room={r} />));

it("draws the people, the outside agent and the Trunk-to-Trunk exchange line of a room in the R1 conversation", async () => {
  await show(room(true));
  const person = host.querySelector(".r1c-room [data-role='person']");
  expect(person?.textContent).toBe("DanaCan we close September today?");
  const agent = host.querySelector(".r1c-room [data-role='agent']");
  expect(agent?.querySelector(".rm-tag")?.textContent).toBe("A2A · agents.example.net");
  const line = host.querySelector("[data-testid='exchange-line']");
  expect(line?.querySelector(".r1x-n")?.textContent).toBe("2 messages with");
  expect(line?.querySelector(".r1x-names")?.textContent).toBe("Scout and Ledger");
  expect(host.querySelector("[data-testid='talked-through']")).toBeNull();
  // The Trunk's report to you stays a reply with its name over it; the viewer's own message stays their bubble.
  expect([...host.querySelectorAll(".r1c-from")].map((n) => n.textContent)).toEqual(["Ledger"]);
  expect([...host.querySelectorAll("[data-role='user']")].map((n) => n.textContent)).toEqual(["Thanks, all."]);
  expect(host.querySelectorAll("[data-role='assistant']").length).toBe(1);
});

it("keeps the plain R1 conversation when no room is given", async () => {
  await show(undefined);
  expect(host.querySelector("[data-testid='exchange-line']")).toBeNull();
  expect(host.querySelector(".r1c-room")).toBeNull();
  expect(host.querySelector(".r1c-from")).toBeNull();
  expect(host.querySelectorAll("[data-role='user']").length).toBe(3);
});

it("closes a room of Trunks with the room line, and keeps a posted Trunk's own face", async () => {
  const posted = historyToBlocks([
    { role: "user", content: "Status?", __branch: { senderIdentity: { type: "profile", id: "p-me" }, senderId: "p-me" } },
    { role: "assistant", content: [{ type: "text", text: "Books are closed." }], stopReason: "stop", __branch: { runId: "r1" } },
  ], [], "agent:ledger:grp", null);
  const scout = { ...posted[1], key: "scout-post", meta: { ...(posted[1] as { meta?: object }).meta, sender: { kind: "trunk", agentId: "scout", posted: true } } } as (typeof posted)[number];
  await act(async () => root.render(<ChatView name="Ledger" history={[...posted, scout]} live={[]} pendingUser={null} running={false} engine={engine} sessionKey="agent:ledger:grp" onAnswer={() => undefined} room={room(true)} />));
  const line = host.querySelector("[data-testid='room-line']");
  expect(line?.textContent).toBe("Messages fromLedgerand Scout");
  expect([...host.querySelectorAll(".r1c-gut [data-face]")].map((n) => n.getAttribute("data-face"))).toEqual(["Ledger", "Scout"]);
});

it("groups the kept items for R1 around each folded exchange", () => {
  const entries = roomEntries(foldTalks(layout(history), "ledger"));
  expect(entries.map((entry) => entry.type)).toEqual(["item", "item", "talk", "item", "item"]);
  const talk = entries[2];
  expect(talk.type === "talk" ? talk.talk.lines.map((l) => l.agentId) : null).toEqual(["scout", null]);
  expect(roomEntries([])).toEqual([]);
});
