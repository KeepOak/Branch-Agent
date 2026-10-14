import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../connect/conversations";
import type { MenuEntry } from "../../glass/Menu";
import { DEFAULT_AWAKE, DEFAULT_LISTED, TRUNK_LISTED } from "../sidebar/row-menu";
import { ROOM_REASONS } from "../../rooms/room-menu";
import { roomRulesItems } from "../../rooms/room-rules";
import { conversationMenu, CONVERSATION_NEED, ROOM_RULE_NEED, roomRuleEntries, WORK_AS, type ConversationMenuContext, type ConversationMenuRun } from "./conversation-menu";

const NOW = new Date(2026, 9, 13, 12, 0, 0).getTime();
const thread = (patch: Partial<Conversation> = {}): Conversation => ({
  key: "agent:ledger:topic-1", title: "Month-end", agentId: "ledger", isMain: false, pinned: false, archived: false, unread: false, snoozedUntil: null,
  createdAt: NOW, updatedAt: NOW, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0, ...patch,
});
const runs = (): ConversationMenuRun => ({
  pin: vi.fn(), rename: vi.fn(), editTrunk: vi.fn(), snooze: vi.fn(), archive: vi.fn(), restore: vi.fn(), toBoard: vi.fn(), exportFile: vi.fn(), exportWebPage: vi.fn(),
  copyConversation: vi.fn(), map: vi.fn(), replay: vi.fn(), lookInside: vi.fn(), workMode: vi.fn(), list: vi.fn(), ownWindow: vi.fn(), startOver: vi.fn(), remove: vi.fn(),
});
const ctx = (patch: Partial<ConversationMenuContext> = {}): ConversationMenuContext => ({
  row: thread(), isDefault: false, now: NOW, hasReply: true, work: { global: "normal", override: null }, ownWindowOff: null, run: runs(), ...patch,
});
const named = (rows: MenuEntry[], label: string) => rows.find(row => row.label === label)!;
const all = (rows: MenuEntry[]): MenuEntry[] => rows.flatMap(row => [row, ...all(row.submenu ?? [])]);

describe("the conversation ••• menu (owner-approved nine rows)", () => {
  it("lists Pin, Rename, Snooze, Archive, Send to the board, Export, View, Start over and Delete, in that order", () => {
    expect(conversationMenu(ctx()).map(row => row.label)).toEqual(["Pin to top", "Rename", "Snooze", "Archive", "Send to the board", "Export", "View", "Start over…", "Delete…"]);
    expect(named(conversationMenu(ctx()), "Delete…").danger).toBe(true);
  });

  it("puts Conversation file, Web page and Copy conversation under Export", () => {
    expect(named(conversationMenu(ctx()), "Export").submenu!.map(row => row.label)).toEqual(["Conversation file", "Web page", "Copy conversation"]);
  });

  it("puts Map and Replay first under View, with Look inside, how agents' work shows, and the layout rows", () => {
    const view = named(conversationMenu(ctx()), "View").submenu!;
    expect(view.map(row => row.label)).toEqual(["Map of this conversation", "Replay this conversation", "Look inside the last reply", WORK_AS, "Split right", "Split down",
      "Side panel", "Hide or show the list", "Open its computer", "Open the browser", "Open in its own window"]);
    expect(named(view, WORK_AS).submenu!.map(row => row.label)).toEqual(["Like Settings (Normal)", "Normal", "Thinking", "Verbose"]);
    expect(named(view, "Map of this conversation").need).toBe(CONVERSATION_NEED.map);
    expect(named(view, "Replay this conversation").local).toBe(true);
  });

  it("names the engine call behind every row that acts, or marks it local, so nothing pretends", () => {
    for (const row of all(conversationMenu(ctx()))) {
      expect(Boolean(row.submenu || row.local || row.need || row.off), row.label).toBe(true);
    }
    expect(named(conversationMenu(ctx()), "Start over…").need).toBe("sessions.reset");
    expect(named(conversationMenu(ctx()), "Delete…").need).toBe("sessions.delete");
    expect(named(conversationMenu(ctx()), "Send to the board").need).toBe("canopy.cards.captureSession");
  });

  it("runs the Classic action behind each row", () => {
    const c = ctx();
    const rows = conversationMenu(c);
    named(rows, "Pin to top").onSelect!();
    named(rows, "Archive").onSelect!();
    named(rows, "Start over…").onSelect!();
    named(rows, "Delete…").onSelect!();
    named(named(rows, "View").submenu!, "Replay this conversation").onSelect!();
    named(named(rows, "View").submenu!, "Map of this conversation").onSelect!();
    named(named(named(rows, "View").submenu!, WORK_AS).submenu!, "Thinking").onSelect!();
    expect(c.run.pin).toHaveBeenCalledTimes(1);
    expect(c.run.archive).toHaveBeenCalledTimes(1);
    expect(c.run.startOver).toHaveBeenCalledTimes(1);
    expect(c.run.remove).toHaveBeenCalledTimes(1);
    expect(c.run.replay).toHaveBeenCalledTimes(1);
    expect(c.run.map).toHaveBeenCalledTimes(1);
    expect(c.run.workMode).toHaveBeenCalledWith("thinking");
  });

  it("keeps the default conversation awake and in the list, and a Trunk's own conversation in the list", () => {
    const rows = conversationMenu(ctx({ isDefault: true, row: thread({ isMain: true }) }));
    expect(named(rows, "Snooze").off).toBe(DEFAULT_AWAKE);
    expect(named(rows, "Archive").off).toBe(DEFAULT_LISTED);
    expect(named(rows, "Delete…").off).toBe(DEFAULT_LISTED);
    const trunk = conversationMenu(ctx({ row: thread({ isMain: true }) }));
    expect(named(trunk, "Archive").off).toBe(TRUNK_LISTED);
    expect(named(trunk, "Rename").local).toBe(true);
  });

  it("shows Unpin, Wake and Restore for a pinned, snoozed or archived conversation", () => {
    const c = ctx({ row: thread({ pinned: true, snoozedUntil: NOW + 3_600_000 }) });
    const rows = conversationMenu(c);
    expect(rows[0].label).toBe("Unpin");
    expect(rows[2].label).toBe("Wake");
    rows[2].onSelect!();
    expect(c.run.snooze).toHaveBeenCalledWith(null);
    expect(conversationMenu(ctx({ row: thread({ archived: true }) }))[3].label).toBe("Restore");
  });

  it("says why Look inside waits for a reply, and hides Open in its own window where the window can't", () => {
    const view = named(conversationMenu(ctx({ hasReply: false, ownWindowOff: "No windows here." })), "View").submenu!;
    expect(named(view, "Look inside the last reply").off).toBe("There's no reply to look inside yet.");
    expect(view.some(row => row.label === "Open in its own window")).toBe(false);
  });
});

describe("Group rules in a group chat (#974 row 21)", () => {
  it("adds Group rules after View only in a group chat, with the current rule on the right", () => {
    expect(conversationMenu(ctx()).some(row => row.label === "Group rules")).toBe(false);
    const rows = conversationMenu(ctx({ room: { ruleWords: "A lead Trunk decides", rules: [] } }));
    expect(rows.map(row => row.label)).toEqual(["Pin to top", "Rename", "Snooze", "Archive", "Send to the board", "Export", "View", "Group rules", "Start over…", "Delete…"]);
    expect(named(rows, "Group rules").hint).toBe("A lead Trunk decides");
  });

  it("re-hosts a Branch group's Who answers rows: lead runs through rooms.rule.set, the others keep their reasons", () => {
    const choose = vi.fn();
    const rules = roomRuleEntries(roomRulesItems({ chatApp: false, branchGroup: true, rule: "lead", choose }));
    expect(rules.map(row => row.label)).toEqual(["A lead Trunk decides", "Everyone, every time", "Only those you @mention"]);
    const lead = named(rules, "A lead Trunk decides");
    expect(lead).toMatchObject({ need: ROOM_RULE_NEED.lead, toggle: true });
    lead.onSelect!();
    expect(choose).toHaveBeenCalledWith("lead");
    expect(named(rules, "Everyone, every time")).toMatchObject({ local: true, off: ROOM_REASONS.everyone });
    expect(named(rules, "Only those you @mention")).toMatchObject({ local: true, off: ROOM_REASONS.mentions });
  });

  it("re-hosts a chat-app group's rows: Everyone and @mention set its activation through sessions.patch", () => {
    const choose = vi.fn();
    const rules = roomRuleEntries(roomRulesItems({ chatApp: true, rule: "mention", choose }));
    expect(named(rules, "A lead Trunk decides")).toMatchObject({ local: true, off: ROOM_REASONS.lead });
    expect(named(rules, "Only those you @mention")).toMatchObject({ need: ROOM_RULE_NEED.activation, toggle: true });
    expect(named(rules, "Everyone, every time").toggle).toBe(false);
    named(rules, "Everyone, every time").onSelect!();
    expect(choose).toHaveBeenCalledWith("always");
    for (const row of all(conversationMenu(ctx({ room: { ruleWords: null, rules } })))) {
      expect(Boolean(row.submenu || row.local || row.need || row.off), row.label).toBe(true);
    }
  });
});
