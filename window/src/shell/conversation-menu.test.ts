import { describe, expect, it } from "vitest";
import type { Conversation } from "../connect/conversations";
import { conversationMenuItems, type ConversationMenuContext, type ConversationMenuRun } from "./conversation-menu";
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
    trunkName: own ? "Research" : "Sapling", ownTrunk: own, canRemoveTrunk: true, online: true, now: new Date(2026, 9, 1, 9, 0).getTime(),
    hasReply: true, talkOff: null, run, ...patch };
}
const shape = (items: MenuItem[]) => items.map((i) => i.kind === "sep" ? "---" : i.kind === "custom" ? "[custom]" : i.kind === "sub" ? `${i.label} ›` : i.kind === "head" || i.kind === "info" ? `[${i.label}]` : `${i.disabled ? "[off] " : ""}${i.label}`);

describe("P54 conversation header menu", () => {
  it("groups the conversation, Trunk, look, export, view and help actions with destructive rows last", () => {
    const items = conversationMenuItems(ctx("regular", true));
    const labels = shape(items);
    expect(labels.filter((x) => x.startsWith("["))).toContain("[This conversation]");
    expect(labels).toContain("[Research]");
    expect(labels).toContain("[Look closer]");
    expect(labels).toContain("Export ›");
    expect(labels).toContain("[View]");
    expect(labels).toContain("[Help]");
    expect(labels).toContain("Copy link");
    expect(labels).not.toContain("Copy ›");
    expect(labels).toContain("Talk live");
    expect(labels).toContain("Archive");
    expect(labels.slice(-2)).toEqual(["Delete this conversation…", "Remove Research…"]);
    expect(items.slice(-2).every((i) => (i.kind === undefined || i.kind === "item") && i.danger)).toBe(true);
    const exportRow = items.find((i) => i.kind === "sub" && i.label === "Export") as Extract<MenuItem, { kind: "sub" }>;
    expect(shape(exportRow.items)).toEqual(["As Markdown", "As a web page", "[off] As a share file, locked…"]);
  });

  it("uses the main, thread and group variants without duplicated rename or destructive controls", () => {
    const main = shape(conversationMenuItems(ctx("regular", false)));
    expect(main).toContain("Rename Sapling…");
    expect(main).not.toContain("Archive");
    expect(main).not.toContain("Snooze ›");
    expect(main).not.toContain("Delete this conversation…");
    const thread = shape(conversationMenuItems(ctx("regular", true)));
    expect(thread).toContain("Rename this thread…");
    const group = shape(conversationMenuItems(ctx("regular", true, { room: [{ label: "Room rules", run: () => {} }] })));
    expect(group).toContain("Rename this group…");
    expect(group).toContain("Room rules");
    expect(group).not.toContain("[Research]");
  });

  it("offers four correctly worded snooze choices and a Wake action", () => {
    const items = conversationMenuItems(ctx("regular", true));
    const snooze = items.find((i) => i.kind === "sub" && i.label === "Snooze") as Extract<MenuItem, { kind: "sub" }>;
    expect(shape(snooze.items)).toEqual(["[Snooze until]", "In 1 hour", "In 3 hours", "Tomorrow", "Next week"]);
    expect((snooze.items[3] as { hint: string }).hint).not.toMatch(/tomorrow/i);
    expect((snooze.items[4] as { hint: string }).hint).toMatch(/Mon/);
    const now = new Date(2026, 9, 1, 9, 0).getTime();
    expect(shape(conversationMenuItems(ctx("regular", true, { row: row({ snoozedUntil: now + 3_600_000 }) })))).toContain("Wake");
    expect(shape(conversationMenuItems(ctx("regular", true, { row: row({ archived: true }) })))).toContain("Restore");
  });

  it("keeps all active view actions wired and greys unavailable ones with reasons", () => {
    calls.length = 0;
    const items = conversationMenuItems(ctx("regular", true));
    for (const label of ["Search in this conversation", "Side panel", "Hide or show the list", "Open in its own window", "Open its computer", "Open the browser", "Switch light or dark", "Why each thing is here"]) {
      const found = items.find((i) => i.kind !== "sub" && i.kind !== "sep" && i.kind !== "head" && i.kind !== "custom" && i.label === label) as Extract<MenuItem, { run: () => void }>;
      expect(found.disabled).toBeUndefined();
      found.run();
    }
    expect(calls).toEqual(["search", "sidePanel", "list", "ownWindow", "computer", "browser", "theme", "guide"]);
    const tower = items.find((i) => i.kind !== "sub" && i.kind !== "sep" && i.kind !== "head" && i.kind !== "custom" && i.label === "Show the Control tower") as Extract<MenuItem, { run: () => void }>;
    expect(tower.disabled).toBeUndefined();
    tower.run();
    expect(calls.at(-1)).toBe("tower");
    expect(shape(conversationMenuItems(ctx("regular", true, { towerVisible: true })))).toContain("Hide the Control tower");
  });

  it("keeps this contact's thread layout behind a click-only View row above Side panel", () => {
    const items = conversationMenuItems(ctx("regular", true, { threadView: { contactName: "Researcher", layout: "column", set: () => undefined } }));
    const view = items.find((i) => i.kind === "sub" && i.label === "View") as Extract<MenuItem, { kind: "sub" }>;
    expect(view.hover).toBe(false);
    const labels = shape(items);
    expect(labels.indexOf("View ›") + 1).toBe(labels.indexOf("Side panel"));
    expect(labels).toContain("Open the browser");
    expect(shape(view.items)).toEqual(["[Researcher’s threads show as]", "Column", "Emoji rail", "Side tabs", "Tabs above the chat"]);
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
