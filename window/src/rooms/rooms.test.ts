import { describe, expect, it } from "vitest";
import { historyToBlocks } from "../thread/history";
import { layout } from "../thread/layout";
import { foldTalks, talkSummary, type TalkItem } from "./fold";
import { describeMembers, isRoom, readParticipants, withSenders } from "./members";
import { roomMenuItems } from "./room-menu";
import { roomRulesItems, ruleToast } from "./room-rules";
import { isMine, readSender } from "./sender";
import { readPeerHosts, readPeerList } from "./useRoom";

// Message shapes follow the engine's own tests: chat-display-projection.forwarded.test.ts (forwarded and cron
// deliveries), chat-display-projection.test.ts (profile / observation sender identities) and
// server-chat.agent-events.test-helpers.ts (senderId / senderName); the A2A channel id is extensions/a2a's "a2a".
const dana = { role: "user", content: "Can we close September today?", timestamp: 1, __branch: { senderIdentity: { type: "profile", id: "p-dana" }, senderId: "p-dana", senderName: "Dana", senderProfileAvatarUrl: "/api/users/p-dana/avatar?v=2" } };
const mine = { role: "user", content: "Yes, go ahead.", timestamp: 2, __branch: { senderIdentity: { type: "profile", id: "p-me" }, senderId: "p-me", senderName: "Me", senderIsOwner: true } };
const plain = { role: "user", content: "no identity", timestamp: 3 };
const a2a = { role: "user", content: "No duplicates.", timestamp: 4, __branch: { senderId: "researcher", senderName: "researcher", senderIdentity: { type: "observation", id: "researcher", pluginId: "a2a", accountId: "default", senderKind: "unknown" } } };
const tg = { role: "user", content: "hi all", timestamp: 5, __branch: { senderId: "77", senderName: "Sam Lee", senderIdentity: { type: "observation", id: "77", pluginId: "telegram", accountId: null, senderKind: "human" } } };
const forwarded = (agentId: string, text: string) => ({ role: "assistant", content: text, senderLabel: `Forwarded from ${agentId}`, senderSession: { sessionKey: `agent:${agentId}:main`, agentId } });
const reply = (text: string, runId: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: 6, __branch: { runId } });
const cron = { role: "assistant", content: "Check the queue.", senderLabel: "Forwarded from Automation", senderSession: { sessionKey: "agent:main:cron:j:run:r", agentId: "main", label: "Automation" } };

describe("readSender", () => {
  it("reads people, A2A agents, chat-app people and other Trunks from what the engine recorded", () => {
    expect(readSender(dana)).toEqual({ kind: "person", id: "p-dana", name: "Dana", avatarUrl: "/api/users/p-dana/avatar?v=2" });
    expect(readSender(a2a)).toEqual({ kind: "agent", id: "researcher", name: "researcher", channel: "a2a" });
    expect(readSender(tg)).toEqual({ kind: "person", id: "77", name: "Sam Lee", channel: "telegram" });
    expect(readSender(forwarded("scout", "found both"))).toEqual({ kind: "trunk", agentId: "scout" });
    expect(readSender(plain)).toBeUndefined();
  });

  it("leaves an automation's delivery alone (it carries the job's name, not a Trunk)", () => {
    expect(readSender(cron)).toBeUndefined();
  });

  it("keeps the viewer's own messages theirs", () => {
    expect(isMine(readSender(mine), true, "p-me")).toBe(true);
    expect(isMine(readSender(dana), false, "p-me")).toBe(false);
    expect(isMine({ kind: "person", id: "p-me", name: "Me" }, false, "p-me")).toBe(true);
    // While users.self is read, a profile message stays on the right; a chat-app sender never is the viewer.
    expect(isMine(readSender(dana), false, undefined)).toBe(true);
    expect(isMine(readSender(tg), false, undefined)).toBe(false);
    expect(isMine(readSender(a2a), false, "p-me")).toBe(false);
    expect(isMine(undefined, false, "p-me")).toBe(true);
  });

  it("travels with the history's blocks", () => {
    const blocks = historyToBlocks([dana, a2a], [], "agent:ledger:grp", null);
    expect(blocks.map((b) => (b.kind === "user" ? b.meta?.sender?.kind : null))).toEqual(["person", "agent"]);
  });
});

describe("foldTalks", () => {
  const history = [dana, forwarded("scout", "@Ledger want me to pull the two missing receipts?"), reply("Yes please. Delta Sep 5.", "r1"), forwarded("scout", "Found both."), mine, reply("All 16 matched.", "r2")];
  const items = () => foldTalks(layout(historyToBlocks(history, [], "agent:ledger:grp", null)), "ledger");

  it("folds an exchange between Trunks into one talked-it-through item, ended by your message", () => {
    const out = items();
    const talk = out.find((i): i is TalkItem => i.type === "talk");
    expect(talk?.from).toBe("scout");
    expect(talk?.lines.map((l) => [l.agentId, l.text])).toEqual([
      ["scout", "@Ledger want me to pull the two missing receipts?"],
      [null, "Yes please. Delta Sep 5."],
      ["scout", "Found both."],
    ]);
    expect(out.filter((i) => i.type === "block").map((i) => (i.type === "block" ? i.block.kind : ""))).toEqual(["user", "user", "text", "done"]);
  });

  it("never folds the Trunk's own forwarded messages", () => {
    const out = foldTalks(layout(historyToBlocks([forwarded("ledger", "note to self")], [], "agent:ledger:x", null)), "ledger");
    expect(out.every((i) => i.type !== "talk")).toBe(true);
  });

  it("says who talked and how much", () => {
    expect(talkSummary("Scout", "Ledger", 3)).toBe("Scout and Ledger talked it through · 3 messages");
    expect(talkSummary("Scout", "Ledger", 1)).toBe("Scout and Ledger talked it through · 1 message");
  });
});

describe("members", () => {
  const session = {
    kind: "direct",
    expandedParticipants: [
      { identity: { type: "profile", id: "p-dana" }, label: "Dana Whitfield" },
      { identity: { type: "profile", id: "p-me" }, label: "Me" },
      { identity: { type: "agent", id: "scout" } },
      { identity: { type: "agent", id: "ledger" } },
      { identity: { type: "observation", id: "researcher", pluginId: "a2a", accountId: null, senderKind: "unknown" }, label: "researcher" },
    ],
  };
  const names: Record<string, string> = { ledger: "Ledger", scout: "Scout" };

  it("sorts participants into Trunks, people and outside agents, leaving out the viewer and the room's own Trunk", () => {
    const m = readParticipants(session, "ledger", "p-me");
    expect(m).toEqual({ trunks: ["scout"], people: [{ id: "p-dana", name: "Dana Whitfield" }], agents: [{ id: "researcher", name: "researcher" }] });
    expect(describeMembers(m, "Ledger", (id) => names[id] ?? id)).toBe("Dana, Ledger, Scout, researcher and you");
  });

  it("is a room when the engine says others are in it, or when it is a chat-app group", () => {
    expect(isRoom(session, "direct", readParticipants(session, "ledger", "p-me"))).toBe(true);
    expect(isRoom({ kind: "direct" }, "direct", readParticipants({}, "ledger", "p-me"))).toBe(false);
    expect(isRoom({ kind: "group", chatType: "group" }, "group", readParticipants({}, "ledger", "p-me"))).toBe(true);
  });

  it("adds the senders the history shows", () => {
    const blocks = historyToBlocks([tg, a2a, mine], [], "agent:ledger:g", null);
    const m = withSenders(readParticipants({}, "ledger", "p-me"), blocks, "ledger", "p-me");
    expect(m.people).toEqual([{ id: "77", name: "Sam Lee" }]);
    expect(m.agents).toEqual([{ id: "researcher", name: "researcher" }]);
  });
});

describe("room menu and rules", () => {
  const run = { rename: () => undefined, rules: () => undefined, leave: () => undefined, remove: () => undefined };

  it("draws the room rows: rename, rules, leave and delete, with the rule words on rules", () => {
    const items = roomMenuItems({ ruleWords: "mentions only", canLeave: true, run });
    expect(items.map((i) => ("label" in i ? i.label : i.kind))).toEqual(["Rename group", "Group rules", "sep", "Leave and archive", "sep", "Delete…"]);
    expect(items[1]).toMatchObject({ hint: "mentions only" });
    expect(roomMenuItems({ ruleWords: null, canLeave: false, run }).map((i) => ("label" in i ? i.label : i.kind))).toEqual(["Rename group", "Group rules", "sep"]);
  });

  it("sets who answers through the engine only in a chat-app group", () => {
    const chosen: string[] = [];
    const group = roomRulesItems({ chatApp: true, rule: "mention", choose: (r) => chosen.push(r) });
    const rows = group.filter((i): i is Extract<typeof i, { run: () => void }> => "run" in i);
    expect(rows.slice(0, 3).map((r) => [r.label, Boolean(r.disabled), r.checked])).toEqual([
      ["A lead Trunk decides", true, false],
      ["Everyone, every time", false, false],
      ["Only those you @mention", false, true],
    ]);
    rows[1].run();
    expect(chosen).toEqual(["always"]);
    const shared = roomRulesItems({ chatApp: false, rule: null, choose: () => undefined }).filter((i) => "run" in i);
    expect(shared.every((i) => "disabled" in i && i.disabled)).toBe(true);
    expect(ruleToast("always", "Month-end")).toBe("Everyone, every time, in Month-end from now on.");
  });

  it("reads where each A2A peer runs from its address, never its tokens", () => {
    expect(readPeerHosts({ channels: { a2a: { peers: { researcher: { token: "t", url: "https://agents.example.net:8443/a2a" }, nourl: { token: "t" } } } } })).toEqual({ researcher: "agents.example.net:8443" });
  });
});

describe("outside agents from a2a.peers.list", () => {
  it("reads where each agent runs and which are online", () => {
    expect(readPeerList({ peers: [{ name: "claude-code", where: "LEGION", online: true }, { name: "hermes", where: null, online: false }, { where: "x" }] })).toEqual({ hosts: { "claude-code": "LEGION" }, online: ["claude-code"] });
    expect(readPeerList(undefined)).toEqual({ hosts: {}, online: [] });
  });
});
