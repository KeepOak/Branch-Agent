import { describe, expect, it } from "vitest";
import type { Conversation } from "../connect/conversations";
import { conversationMenuItems, keyHint, type ConversationMenuContext, type ConversationMenuRun } from "./conversation-menu";
import type { MenuItem } from "./Menu";
import { conversationLink, publicShareLink, readDetail } from "./ConversationMenu";
import { readSharing } from "./ShareDialog";
import { knownTrunks, mayTalk } from "./who-it-knows";

const calls: string[] = [];
const run = new Proxy({}, { get: (_, name) => (...args: unknown[]) => calls.push(`${String(name)}${args.length ? `:${JSON.stringify(args)}` : ""}`) }) as ConversationMenuRun;
const row = (patch: Partial<Conversation> = {}): Conversation => ({
  key: "agent:research:abc", title: "Research", agentId: "research", isMain: false, pinned: true, archived: false, unread: false, snoozedUntil: null,
  createdAt: 0, updatedAt: 0, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0, sessionId: "s1", ...patch,
});
function ctx(_level: string, own: boolean, patch: Partial<ConversationMenuContext> = {}): ConversationMenuContext {
  return { row: own ? row() : row({ key: "agent:main:main", agentId: "main", isMain: true, title: "" }), isMain: !own,
    trunkName: own ? "Research" : "Sapling", ownTrunk: own, canRemoveTrunk: true, mac: false, now: new Date(2026, 9, 1, 9, 0).getTime(),
    hasReply: true, talkOff: null, run, ...patch };
}
const shape = (items: MenuItem[]) => items.map((i) => i.kind === "sep" ? "---" : i.kind === "custom" ? "[custom]" : i.kind === "sub" ? `${i.label} ›` : i.kind === "head" || i.kind === "info" ? `[${i.label}]` : `${i.disabled ? "[off] " : ""}${i.label}`);
/** Every row under a menu, flattened: the submenus' rows follow their parent. */
const flat = (items: MenuItem[]): MenuItem[] => items.flatMap((i) => (i.kind === "sub" ? [i, ...flat(i.items)] : [i]));
const leaves = (items: MenuItem[]) => flat(items).filter((i): i is Extract<MenuItem, { run: () => void }> => i.kind === undefined || i.kind === "item");
const more = (items: MenuItem[]) => (items.find((i) => i.kind === "sub" && i.label === "More") as Extract<MenuItem, { kind: "sub" }>).items;
const leaf = (items: MenuItem[], label: string) => leaves(items).find((i) => i.label === label);

describe("P54 conversation header menu", () => {
  it("shows six actions, the Trunk and More at the top, with no developer rows", () => {
    expect(shape(conversationMenuItems(ctx("regular", true)))).toEqual([
      "Unpin", "Share this conversation…", "Clear messages and start fresh…", "Archive", "---", "Research…", "---", "More ›",
    ]);
    const all = leaves(conversationMenuItems(ctx("regular", true, { canMove: true }))).map((i) => i.label);
    expect(all).not.toEqual(expect.arrayContaining(["Reload", "Copy link", "Send to the board", "Research’s profile", "Edit Research…"]));
  });

  it("keeps every other action reachable under More", () => {
    const labels = leaves(more(conversationMenuItems(ctx("regular", true)))).map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining([
      "Talk live", "Rename this thread…", "Who Research knows", "Make a card on the Canopy board", "Look inside the last reply", "Map of this conversation",
      "Replay this conversation", "As Markdown", "As a web page", "Side panel", "Hide or show the list", "Open the browser", "Switch light or dark",
      "Why each thing is here", "Delete this conversation…", "Remove Research…",
    ]));
  });

  it("uses the Trunk entry for the profile, where editing lives", () => {
    calls.length = 0;
    const trunk = conversationMenuItems(ctx("regular", true)).find((i) => i.kind === undefined && i.label === "Research…") as Extract<MenuItem, { run: () => void }>;
    trunk.run();
    expect(calls).toEqual(["profile"]);
  });

  it("uses ⌘ for shortcut hints on a Mac and Ctrl elsewhere", () => {
    expect(keyHint("Ctrl Shift K", true)).toBe("⌘⇧K");
    expect(keyHint("Ctrl F", false)).toBe("Ctrl F");
    expect((more(conversationMenuItems(ctx("regular", true))).find((i) => i.kind === "sub" && i.label === "View") as Extract<MenuItem, { kind: "sub" }>).hover).toBe(false);
    expect(leaf(conversationMenuItems(ctx("regular", true, { mac: true })), "Side panel")?.hint).toBe("⌘⇧K");
    expect(leaf(conversationMenuItems(ctx("regular", true, { mac: false })), "Side panel")?.hint).toBe("Ctrl Shift K");
  });

  it("shows Move to computer only when another computer exists", () => {
    expect(shape(conversationMenuItems(ctx("regular", true, { canMove: true })))).toContain("Move to computer…");
    expect(shape(conversationMenuItems(ctx("regular", true)))).not.toContain("Move to computer…");
  });

  it("hides Talk live while voice is off, and leaves no greyed row without a reason", () => {
    const off = "Off until you choose: it uses the microphone.";
    expect(leaf(conversationMenuItems(ctx("regular", true, { talkOff: off })), "Talk live")).toBeUndefined();
    expect(leaf(conversationMenuItems(ctx("regular", true, { talkOff: null })), "Talk live")?.disabled).toBeUndefined();
    for (const entry of leaves(conversationMenuItems(ctx("regular", true, { talkOff: off, ownWindowOff: "Not here." })))) {
      if (entry.disabled !== undefined) expect(entry.disabled.length).toBeGreaterThan(0);
    }
  });

  it("uses the main, thread and group variants without duplicated rename or destructive controls", () => {
    const mainTop = shape(conversationMenuItems(ctx("regular", false)));
    expect(mainTop).toContain("Sapling…");
    expect(mainTop).not.toContain("Archive");
    const mainMore = leaves(more(conversationMenuItems(ctx("regular", false)))).map((i) => i.label);
    expect(mainMore).not.toContain("Delete this conversation…");
    expect(mainMore).not.toContain("Rename Sapling…");
    expect(shape(more(conversationMenuItems(ctx("regular", true))))).toEqual(expect.arrayContaining(["Snooze ›"]));
    const group = conversationMenuItems(ctx("regular", true, { room: [{ label: "Room rules", run: () => {} }] }));
    expect(shape(group)).not.toContain("Research…");
    expect(leaves(more(group)).map((i) => i.label)).toEqual(expect.arrayContaining(["Room rules", "Rename this group…"]));
  });

  it("offers four correctly worded snooze choices and a Wake action", () => {
    const snooze = more(conversationMenuItems(ctx("regular", true))).find((i) => i.kind === "sub" && i.label === "Snooze") as Extract<MenuItem, { kind: "sub" }>;
    expect(shape(snooze.items)).toEqual(["[Snooze until]", "In 1 hour", "In 3 hours", "Tomorrow", "Next week"]);
    expect((snooze.items[3] as { hint: string }).hint).not.toMatch(/tomorrow/i);
    expect((snooze.items[4] as { hint: string }).hint).toMatch(/Mon/);
    const now = new Date(2026, 9, 1, 9, 0).getTime();
    expect(leaves(more(conversationMenuItems(ctx("regular", true, { row: row({ snoozedUntil: now + 3_600_000 }) })))).map((i) => i.label)).toContain("Wake");
    expect(shape(conversationMenuItems(ctx("regular", true, { row: row({ archived: true }) })))).toContain("Restore");
  });

  it("keeps the view actions wired", () => {
    calls.length = 0;
    const items = conversationMenuItems(ctx("regular", true));
    for (const label of ["Side panel", "Hide or show the list", "Open in its own window", "Open its computer", "Open the browser", "Switch light or dark", "Why each thing is here"]) {
      const found = leaf(items, label)!;
      expect(found.disabled).toBeUndefined();
      found.run();
    }
    expect(calls).toEqual(["sidePanel", "list", "ownWindow", "computer", "browser", "theme", "guide"]);
    expect(shape(conversationMenuItems(ctx("regular", true, { towerVisible: true })))).toBeDefined();
    expect(leaves(more(conversationMenuItems(ctx("regular", true, { towerVisible: true })))).map((i) => i.label)).toContain("Hide the Control tower");
  });

  it("keeps this contact's thread layout as a click-only row inside View", () => {
    const items = conversationMenuItems(ctx("regular", true, { threadView: { contactName: "Researcher", layout: "column", set: () => undefined } }));
    const view = more(items).find((i) => i.kind === "sub" && i.label === "View") as Extract<MenuItem, { kind: "sub" }>;
    const threads = view.items.find((i) => i.kind === "sub" && i.label === "Threads show as") as Extract<MenuItem, { kind: "sub" }>;
    expect(threads.hover).toBe(false);
    expect(shape(threads.items)).toEqual(["[Researcher’s threads show as]", "Column", "Emoji rail", "Side tabs", "Tabs above the chat"]);
    expect(shape(view.items).indexOf("Side panel")).toBeGreaterThan(shape(view.items).indexOf("Threads show as ›"));
  });
});

describe("the menu's engine reads", () => {
  it("reads thinking from sessions.describe", () => {
    expect(readDetail({ session: { reasoningLevel: "on" } })).toEqual({ showThinking: true });
    expect(readDetail({ session: {} })).toEqual({ showThinking: true });
  });
  it("builds conversation and public share links from the window and engine addresses", () => {
    expect(conversationLink("agent:main:x y", "http://127.0.0.1:5174/?a=1#top")).toBe("http://127.0.0.1:5174/?conversation=agent%3Amain%3Ax+y");
    expect(publicShareLink("v1.abc", "ws://127.0.0.1:19011")).toBe("http://127.0.0.1:19011/share/session?token=v1.abc");
    expect(publicShareLink("v1.abc", "ws://127.0.0.1:19011", "https://box.example/ui/")).toBe("https://box.example/ui/share/session?token=v1.abc");
  });
  it("reads who may see a conversation from session.members.list", () => {
    const s = readSharing({ role: "owner", allowedVisibilities: ["shared", "read-only", "draft"], owner: { id: "me", displayName: "Me" }, members: [{ identityId: "p2", addedBy: "me", addedAt: 1 }], identities: [{ id: "me" }, { id: "p2", displayName: "Pat Two" }, { id: "p3" }] }, "read-only");
    expect(s.visibility).toBe("read-only");
    expect(s.canChange).toBe(true);
    expect(s.people.map((p) => p.name)).toEqual(["Pat Two", "p3"]);
    expect([...s.members]).toEqual(["p2"]);
  });
  it("follows tools.agentToAgent the way the engine does", () => {
    const trunks = [{ id: "main" }, { id: "research" }, { id: "money" }];
    expect(knownTrunks(undefined, undefined, "research", trunks).map((t) => t.id)).toEqual(["main", "money"]);
    expect(knownTrunks({ enabled: false }, undefined, "research", trunks)).toEqual([]);
    expect(knownTrunks({ allow: ["res*", "main"] }, undefined, "research", trunks).map((t) => t.id)).toEqual(["main"]);
    expect(mayTalk({ allow: [""] }, undefined, "a", "b")).toBe(false);
    expect(mayTalk({ allow: ["*"] }, undefined, "a", "b")).toBe(true);
  });
});
