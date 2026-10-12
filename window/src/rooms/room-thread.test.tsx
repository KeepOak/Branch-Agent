// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Thread } from "../thread/Thread";
import { historyToBlocks } from "../thread/history";
import type { Block } from "../thread/model";
import type { ThreadRoom } from "./thread-room";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
});
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

// Engine-shaped history (see rooms.test.ts for where each shape comes from).
const messages = [
  { role: "user", content: "Can we close September today?", __branch: { senderIdentity: { type: "profile", id: "p-dana" }, senderId: "p-dana", senderName: "Dana" } },
  { role: "assistant", content: [{ type: "text", text: "Yes. 14 of 16 receipts match." }], stopReason: "stop", __branch: { runId: "r1" } },
  { role: "assistant", content: "@Ledger want me to pull the two missing receipts?", senderLabel: "Forwarded from scout", senderSession: { sessionKey: "agent:scout:main", agentId: "scout" } },
  { role: "assistant", content: [{ type: "text", text: "Yes **please**." }], stopReason: "stop", __branch: { runId: "r2" } },
  { role: "user", content: "No duplicates.", __branch: { senderId: "researcher", senderName: "researcher", senderIdentity: { type: "observation", id: "researcher", pluginId: "a2a", accountId: null, senderKind: "unknown" } } },
  { role: "user", content: "Thanks @Scout, mail me at me@example.com.", __branch: { senderIdentity: { type: "profile", id: "p-me" }, senderId: "p-me", senderName: "Me" } },
];
const names: Record<string, string> = { ledger: "Ledger", scout: "Scout" };
const room = (isRoom: boolean): ThreadRoom => ({ isRoom, selfId: "p-me", ownAgentId: "ledger", trunkName: (id) => names[id] ?? id, whereRuns: (peer) => (peer === "researcher" ? "agents.example.net" : null) });

async function render(r: ThreadRoom, list: unknown[] = messages, extra: Block[] = []) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const history = [...historyToBlocks(list, [], "agent:ledger:grp", null), ...extra];
  await act(async () => root!.render(<Thread name="Ledger" history={history} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} room={r} />));
  return host;
}

describe("a room's thread", () => {
  it("draws people, the outside agent, the talked-it-through fold and the sender over each Trunk run", async () => {
    const host = await render(room(true));
    const person = host.querySelector('[data-role="person"]');
    expect(person?.textContent).toBe("DanaCan we close September today?");
    expect(host.querySelector(".rm-msg .rm-av")?.textContent).toBe("D");
    const agent = host.querySelector('[data-role="agent"]');
    expect(agent?.closest(".rm-ext")).not.toBeNull();
    expect(agent?.querySelector(".rm-tag")?.textContent).toBe("A2A · agents.example.net");
    const fold = host.querySelector("[data-testid=talked-through] details");
    expect(fold?.hasAttribute("open")).toBe(false);
    expect(fold?.querySelector("summary .rm-talk-n")?.textContent).toBe("2 messages with 2 agents");
    expect(fold?.querySelector("summary .rm-talk-who")?.textContent).toBe("Scout and Ledger");
    expect([...(fold?.querySelectorAll(".rm-talk-l b") ?? [])].map((b) => b.textContent)).toEqual(["Scout", "Ledger"]);
    expect(fold?.querySelector(".rm-mention")?.textContent).toBe("@Ledger");
    expect(host.querySelector(".reply-from")?.textContent).toBe("Ledger");
    // The viewer's own message stays their bubble.
    const mineBubble = host.querySelector('[data-role="user"]');
    expect(mineBubble?.textContent).toBe("Thanks @Scout, mail me at me@example.com.");
    expect([...(mineBubble?.querySelectorAll(".rm-mention") ?? [])].map((m) => m.textContent)).toEqual(["@Scout"]);
    expect(fold?.querySelector("strong")?.textContent).toBe("please");
  });

  it("collapses three agent-to-agent messages into one '3 messages with 2 agents' row and keeps the Trunk's report to you", async () => {
    const talk = [
      { role: "user", content: "Close September?", __branch: { senderIdentity: { type: "profile", id: "p-me" }, senderId: "p-me", senderName: "Me", senderIsOwner: true } },
      { role: "assistant", content: [{ type: "text", text: "Done. September is closed." }], stopReason: "stop", __branch: { runId: "r1" } },
      { role: "assistant", content: "@Ledger want me to pull the two missing receipts?", senderLabel: "Forwarded from scout", senderSession: { sessionKey: "agent:scout:main", agentId: "scout" } },
      { role: "assistant", content: [{ type: "text", text: "Yes please." }], stopReason: "stop", __branch: { runId: "r2" } },
      { role: "assistant", content: "Found both.", senderLabel: "Forwarded from scout", senderSession: { sessionKey: "agent:scout:main", agentId: "scout" } },
    ];
    const host = await render(room(true), talk);
    const rows = host.querySelectorAll("[data-testid=talked-through]");
    expect(rows).toHaveLength(1);
    const fold = rows[0]!.querySelector("details");
    expect(fold?.hasAttribute("open")).toBe(false);
    expect(fold?.querySelector("summary .rm-talk-n")?.textContent).toBe("3 messages with 2 agents");
    expect(fold?.querySelectorAll(".rm-talk-l")).toHaveLength(3);
    // The agents' messages are only in the fold; the report to you stays a reply of its own, under the Trunk's name.
    const replies = [...host.querySelectorAll('[data-role="assistant"]')].filter((node) => !node.closest("[data-testid=talked-through]"));
    expect(replies.map((node) => node.querySelector(".reply-from")?.textContent ?? "")).toEqual(["Ledger"]);
    expect(replies[0]?.textContent).toContain("Done. September is closed.");
  });

  it("shows another Trunk's report from the room's log under its own name and face, and folds the chatter after it", async () => {
    const asked = [{ role: "user", content: "Status?", __branch: { senderIdentity: { type: "profile", id: "p-me" }, senderId: "p-me", senderName: "Me", senderIsOwner: true } }];
    const post = (agentId: string | null, key: string, text: string): Block => ({ kind: "text", key, text, streaming: false, meta: agentId ? { sender: { kind: "trunk", agentId, posted: true } } : {} });
    const host = await render(room(true), asked, [
      post(null, "l0", "Ledger: books balanced."),
      post("scout", "s1", "Scout: receipts filed. @Ledger check Delta?"),
      post(null, "l1", "Delta matches."),
      post("scout", "s2", "Thanks."),
      post(null, "l2", "Logged."),
    ]);
    const replies = [...host.querySelectorAll('[data-role="assistant"]')].filter((node) => !node.closest("[data-testid=talked-through]"));
    expect(replies.map((node) => [node.querySelector(".reply-from")?.textContent, node.querySelector(".md, p")?.textContent ?? node.textContent])).toEqual([
      ["Ledger", expect.stringContaining("books balanced")],
      ["Scout", expect.stringContaining("receipts filed")],
    ]);
    expect(replies[1]?.closest(".msg")?.querySelector(".gutter [aria-label]")?.getAttribute("aria-label")).toBe("Scout");
    expect(host.querySelector("[data-testid=talked-through] .rm-talk-n")?.textContent).toBe("3 messages with 2 agents");
  });

  it("outside a room, keeps people and agents apart but shows no sender over the replies", async () => {
    const host = await render(room(false));
    expect(host.querySelector('[data-role="agent"]')).not.toBeNull();
    expect(host.querySelector(".reply-from")).toBeNull();
  });

  it("closes a room of Trunks with the room line, and leaves it out where people write", async () => {
    const trunksOnly = messages.filter((m) => m.role === "assistant");
    expect((await render(room(true), trunksOnly)).querySelector("[data-testid=room-line]")?.textContent).toBe("Messages fromLedgerand Scout");
    await act(async () => root!.unmount());
    root = undefined;
    expect((await render(room(true))).querySelector("[data-testid=room-line]")).toBeNull();
  });

  it("draws an MCP client (Claude Code) in a Trunk's own thread as an online outside agent, not as the owner", async () => {
    const fromClaude = [
      { role: "user", content: "Reply with exactly OK", __branch: { senderIsOwner: true, senderId: "claude-code", senderName: "Claude Code", senderIdentity: { type: "observation", id: "claude-code", pluginId: "a2a", accountId: "mcp", senderKind: "bot" } } },
      { role: "assistant", content: [{ type: "text", text: "OK" }], stopReason: "stop", __branch: { runId: "r9" } },
    ];
    const r: ThreadRoom = { ...room(false), whereRuns: (peer) => (peer === "claude-code" ? "LEGION" : null), isOnline: (peer) => peer === "claude-code" };
    const host = await render(r, fromClaude);
    const agent = host.querySelector('[data-role="agent"]');
    expect(agent?.closest(".rm-ext")).not.toBeNull();
    expect(agent?.querySelector("b")?.firstChild?.textContent).toBe("Claude Code");
    expect(agent?.querySelector(".rm-tag")?.textContent).toBe("A2A · LEGION");
    expect(host.querySelector(".rm-ext .rm-av")?.textContent).toBe("CC");
    expect(host.querySelector(".rm-ext .rm-av .rm-st-online")).not.toBeNull();
    expect(host.querySelector('[data-role="user"]')).toBeNull();
  });
});
