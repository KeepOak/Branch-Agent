// @vitest-environment jsdom
// Trunk-to-Trunk traffic in the R1 conversation (preview item 23): consecutive messages between Trunks fold into one centred
// line "N messages with [faces] A and B"; a face opens the exchange read-only over the chat; Close Chat or Escape returns.
// The Classic thread keeps its own "talked it through" row.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { ThreadRoom } from "../../rooms/thread-room";
import { historyToBlocks } from "../../thread/history";
import { Thread } from "../../thread/Thread";
import { ChatView } from "./ChatView";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-face={label} /> }));
vi.mock("../../composer/useConversation", () => ({ useConversation: () => ({ loaded: false }), hasNoModel: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
});

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const engine = { request: vi.fn(async () => ({})), onEvent: () => () => undefined, sessionKey: "agent:ledger:main", agentId: "ledger", scopes: ["operator.admin"], features: { methods: ["chat.send"], events: [] } } as unknown as WindowEngine;
const T0 = Date.UTC(2026, 9, 8, 20, 37);
const me = (text: string, at: number) => ({ role: "user", content: text, timestamp: at, __branch: { senderIdentity: { type: "profile", id: "p-me" }, senderId: "p-me", senderName: "Me", senderIsOwner: true } });
const reply = (text: string, at: number, run: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: at, __branch: { runId: run } });
// A message another Trunk sent this one (sessions_send), as chat.history shows it: forwarded, with senderSession.agentId.
const from = (agentId: string, text: string, at: number) => ({ role: "assistant", content: text, timestamp: at, senderLabel: "Forwarded from " + agentId, senderSession: { sessionKey: "agent:" + agentId + ":main", agentId } });
const messages = [
  me("Close September today?", T0),
  reply("On it.", T0 + 1000, "r1"),
  from("scout", "@Ledger want me to pull the two missing receipts?", T0 + 60_000),
  reply("Yes please.", T0 + 61_000, "r2"),
  from("scout", "Pulled both. One is a duplicate.", T0 + 120_000),
  reply("Thanks, dropping the duplicate.", T0 + 121_000, "r3"),
  me("And October?", T0 + 200_000),
  from("scout", "October receipts are in the shared folder.", T0 + 260_000),
  reply("Got them.", T0 + 261_000, "r4"),
];
const names: Record<string, string> = { ledger: "Ledger", scout: "Scout" };
const room: ThreadRoom = { isRoom: false, selfId: "p-me", ownAgentId: "ledger", trunkName: (id) => names[id] ?? id, whereRuns: () => null };
const history = historyToBlocks(messages, [], "agent:ledger:main", null);

async function show() {
  await act(async () => root.render(<div className="r1-conversation"><ChatView name="Ledger" history={history} live={[]} pendingUser={null} running={false} engine={engine} sessionKey="agent:ledger:main" onAnswer={() => undefined} room={room} /></div>));
}
const lines = () => [...host.querySelectorAll<HTMLElement>("[data-testid='exchange-line']")];
const view = () => document.querySelector<HTMLElement>("[data-testid='exchange-view']");

it("folds consecutive Trunk-to-Trunk messages into one centred line with the count, the faces and the names", async () => {
  await show();
  const [first] = lines();
  expect(first?.querySelector(".r1x-n")?.textContent).toBe("4 messages with");
  expect([...first!.querySelectorAll(".r1x-face [data-face]")].map((f) => f.getAttribute("data-face"))).toEqual(["Scout", "Ledger"]);
  expect(first?.querySelector(".r1x-names")?.textContent).toBe("Scout and Ledger");
  // None of the folded messages is drawn as a reply in the chat; your own messages and Ledger's report to you are.
  expect([...host.querySelectorAll("[data-role='user']")].map((n) => n.textContent)).toEqual(["Close September today?", "And October?"]);
  expect(host.querySelector(".r1c-thread")?.textContent).toContain("On it.");
  // Every folded message stays in the page for Find and screen readers.
  expect(first?.querySelector(".r1x-transcript")?.textContent).toContain("Pulled both. One is a duplicate.");
});

it("starts a new line after a person's message", async () => {
  await show();
  expect(lines().map((l) => l.querySelector(".r1x-n")?.textContent)).toEqual(["4 messages with", "2 messages with"]);
});

it("opens the exchange read-only from a face, with both faces in its header and Close Chat; Close returns focus to the face", async () => {
  await show();
  const face = lines()[0]!.querySelector<HTMLButtonElement>(".r1x-face")!;
  expect(face.getAttribute("aria-label")).toBe("Open the messages with Scout");
  face.focus();
  await act(async () => face.click());
  const v = view();
  expect(v?.getAttribute("role")).toBe("dialog");
  expect(v?.getAttribute("aria-label")).toBe("Scout and Ledger");
  // Drawn over the conversation column, not inside the scrolling thread.
  expect(v?.parentElement?.classList.contains("r1-conversation")).toBe(true);
  const head = v!.querySelector("[data-testid='exchange-head']")!;
  expect([...head.querySelectorAll("[data-face]")].map((f) => f.getAttribute("data-face"))).toEqual(["Scout", "Ledger"]);
  expect(head.textContent).toBe("Scout⇄Ledger");
  const msgs = [...v!.querySelectorAll<HTMLElement>("[data-testid='exchange-message']")];
  expect(msgs.map((m) => m.querySelector("p")?.textContent)).toEqual(["@Ledger want me to pull the two missing receipts?", "Yes please.", "Pulled both. One is a duplicate.", "Thanks, dropping the duplicate."]);
  expect(msgs.map((m) => m.querySelector("b")?.textContent)).toEqual(["Scout", "Ledger", "Scout", "Ledger"]);
  expect(msgs.map((m) => m.hasAttribute("data-me"))).toEqual([true, false, true, false]);
  expect(v!.querySelectorAll("[data-testid='time-divider']").length).toBe(1);
  // Read-only: no composer, no message box, no hover bar.
  expect(v!.querySelector("textarea, input, [contenteditable], .r1c-bar")).toBeNull();
  const close = v!.querySelector<HTMLButtonElement>(".r1x-close")!;
  expect(close.textContent).toBe("Close Chat");
  expect(document.activeElement).toBe(close);
  await act(async () => close.click());
  expect(view()).toBeNull();
  expect(document.activeElement).toBe(face);
});

it("closes the exchange with Escape and returns to the face", async () => {
  await show();
  const face = lines()[1]!.querySelectorAll<HTMLButtonElement>(".r1x-face")[1]!;
  await act(async () => face.click());
  expect(view()?.querySelectorAll("[data-testid='exchange-message']").length).toBe(2);
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(view()).toBeNull();
  expect(document.activeElement).toBe(face);
});

it("lists who talked from the names, and Show all opens every message", async () => {
  await show();
  const names = lines()[0]!.querySelector<HTMLButtonElement>(".r1x-names")!;
  await act(async () => names.click());
  const pop = document.querySelector(".r1x-pop")!;
  expect([...pop.querySelectorAll(".r1c-mi")].map((b) => b.textContent)).toEqual(["Scout", "Ledger", "Show all 4 messages"]);
  await act(async () => (pop.querySelectorAll<HTMLButtonElement>(".r1c-mi")[2]!).click());
  expect(document.querySelector(".r1x-pop")).toBeNull();
  expect(view()?.querySelectorAll("[data-testid='exchange-message']").length).toBe(4);
  expect(view()?.querySelector("[data-me]")).toBeNull();
});

it("leaves the Classic thread's talked-it-through row unchanged", async () => {
  await act(async () => root.render(<Thread name="Ledger" history={history} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} room={room} />));
  const fold = host.querySelector("[data-testid=talked-through] details");
  expect(fold?.querySelector("summary .rm-talk-n")?.textContent).toBe("4 messages with 2 agents");
  expect(host.querySelector("[data-testid='exchange-line']")).toBeNull();
});
