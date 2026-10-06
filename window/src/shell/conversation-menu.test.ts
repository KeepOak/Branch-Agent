import { describe, expect, it } from "vitest";
import type { Conversation } from "../connect/conversations";
import type { Level } from "../places-nav/settings-nav";
import { conversationMenuItems, OFF_REASONS, type ConversationMenuContext, type ConversationMenuRun } from "./conversation-menu";
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

function ctx(level: Level, own: boolean, patch: Partial<ConversationMenuContext> = {}): ConversationMenuContext {
  return {
    row: own ? row() : row({ key: "agent:main:main", agentId: "main", isMain: true, title: "" }),
    isMain: !own,
    trunkName: own ? "Research" : "Sapling",
    ownTrunk: own,
    canRemoveTrunk: true,
    level,
    online: true,
    now: new Date(2026, 9, 1, 9, 0).getTime(),
    hasReply: true,
    talkOff: null,
    detail: { verboseLevel: "on", showThinking: false, workspace: "C:/work/research" },
    fileManager: "Show in File Explorer",
    run,
    ...patch,
  };
}

/** The rows as the preview probe lists them: "---" for a line, " ›" after a submenu, "[off]" before a greyed row. */
const shape = (items: MenuItem[]) => items.map((i) => (i.kind === "sep" ? "---" : i.kind === "custom" ? "[custom]" : i.kind === "sub" ? `${i.label} ›` : i.kind === "head" || i.kind === "info" ? i.label : `${i.disabled ? "[off] " : ""}${i.label}`));

// The preview's rows (app-latest, the conversation ⋯ menu). Move this conversation shows only with a second computer;
// Share this Trunk is greyed (no engine method); Icon and colour is Advanced. "Folder ›" shows because the engine reports a folder.
const REGULAR_OWN = [
  "Open another conversation beside", "Split right", "Split down",
  "Open in its own window", "Share…", "[off] Share this Trunk…", "Who it knows", "Reload conversation", "---", "Send to the board", "---",
  "Archive", "Snooze ›", "Copy ›", "Folder ›", "---",
  "Unpin", "[off] Pause this Trunk", "Rename", "Research’s profile", "Edit Trunk…", "[off] Show it how, once", "[off] Make default",
  "Talk live", "Look inside the last reply", "Start over…", "Export conversation", "---",
  "Map of this conversation", "Replay this conversation", "Export as a web page", "[off] Export a share file, locked…", "Delete…", "Remove Trunk…",
];

describe("conversationMenuItems", () => {
  it("offers Pin to top on a Trunk's main conversation (every Trunk row in the list is one; P2)", () => {
    const main = row({ key: "agent:main:main", agentId: "main", isMain: true, pinned: false, title: "" });
    expect(shape(conversationMenuItems(ctx("regular", false, { row: main })))).toContain("Pin");
    expect(shape(conversationMenuItems(ctx("regular", false, { row: { ...main, pinned: true } })))).toContain("Unpin");
  });

  it("draws a Trunk's conversation at Regular in the preview's order", () => {
    expect(shape(conversationMenuItems(ctx("regular", true)))).toEqual(REGULAR_OWN);
  });

  it("adds View and Step updates at Advanced, and the raw file, steps and About at Technical", () => {
    const adv = shape(conversationMenuItems(ctx("advanced", true)));
    expect(adv.slice(adv.indexOf("Copy ›"), adv.indexOf("Copy ›") + 4)).toEqual(["Copy ›", "View ›", "Step updates ›", "Folder ›"]);
    const tech = shape(conversationMenuItems(ctx("technical", true)));
    expect(tech.slice(tech.indexOf("Start over…"), tech.indexOf("Start over…") + 5)).toEqual(["Start over…", "[off] Open the raw file", "Export its steps", "Export conversation", "About this conversation"]);
  });

  it("leaves archive, snooze, delete and the Trunk-only rows off the default Trunk's main conversation", () => {
    const main = shape(conversationMenuItems(ctx("regular", false)));
    for (const label of ["Archive", "Snooze ›", "Delete…", "Remove Trunk…", "[off] Pause this Trunk", "[off] Make default", "[off] Show it how, once"]) {
      expect(main).not.toContain(label);
    }
    expect(main).toContain("Sapling’s profile");
  });

  it("greys each row the engine has no method for, with the reason", () => {
    const items = conversationMenuItems(ctx("technical", true)) as Extract<MenuItem, { run: () => void }>[];
    const reasonOf = (label: string) => items.find((i) => i.label === label)?.disabled;
    expect(reasonOf("Pause this Trunk")).toBe(OFF_REASONS.pause);
    expect(reasonOf("Open the raw file")).toBe(OFF_REASONS.rawFile);
    expect(reasonOf("Export a share file, locked…")).toBe(OFF_REASONS.shareFile);
    const offline = conversationMenuItems(ctx("regular", true, { online: false, hasReply: false, talkOff: "Turn it on in Settings › Voice." })) as Extract<MenuItem, { run: () => void }>[];
    expect(offline.find((i) => i.label === "Reload conversation")?.disabled).toBe(OFF_REASONS.offline);
    expect(offline.find((i) => i.label === "Look inside the last reply")?.disabled).toBe(OFF_REASONS.noReply);
    expect(offline.find((i) => i.label === "Talk live")?.disabled).toBe("Turn it on in Settings › Voice.");
  });

  it("brings the agent window back from the menu once it is closed", () => {
    const rows = shape(conversationMenuItems(ctx("regular", true, { characterHidden: true })));
    expect(rows.slice(rows.indexOf("Talk live"), rows.indexOf("Talk live") + 2)).toEqual(["Talk live", "Show Research’s window"]);
    expect(shape(conversationMenuItems(ctx("regular", true)))).not.toContain("Show Research’s window");
  });

  it("offers Wake instead of Snooze while snoozed, and Restore on an archived one", () => {
    const now = new Date(2026, 9, 1, 9, 0).getTime();
    const snoozed = shape(conversationMenuItems(ctx("regular", true, { row: row({ snoozedUntil: now + 3_600_000 }) })));
    expect(snoozed).toContain("Wake");
    const archived = shape(conversationMenuItems(ctx("regular", true, { row: row({ archived: true }) })));
    expect(archived).toContain("Restore");
    expect(archived).not.toContain("Snooze ›");
  });

  it("runs Step updates and View with the engine values", () => {
    calls.length = 0;
    const items = conversationMenuItems(ctx("advanced", true));
    const steps = items.find((i) => i.kind === "sub" && i.label === "Step updates") as Extract<MenuItem, { kind: "sub" }>;
    expect(shape(steps.items)).toEqual(["Step updates", "Off", "On", "Full"]);
    expect((steps.items[2] as { checked?: boolean }).checked).toBe(true);
    (steps.items[3] as { run: () => void }).run();
    const view = items.find((i) => i.kind === "sub" && i.label === "View") as Extract<MenuItem, { kind: "sub" }>;
    (view.items[1] as { run: () => void }).run();
    expect(calls).toEqual(['stepUpdates:["full"]', "showThinking:[true]"]);
  });

  it("shows Copy's rows by level", () => {
    const copyAt = (level: Level) => shape((conversationMenuItems(ctx(level, true)).find((i) => i.kind === "sub" && i.label === "Copy") as Extract<MenuItem, { kind: "sub" }>).items);
    expect(copyAt("regular")).toEqual(["Copy", "Conversation link"]);
    expect(copyAt("technical")).toEqual(["Copy", "Conversation link", "Conversation as Markdown", "Conversation ID"]);
  });
});

describe("the menu's engine reads", () => {
  it("reads step updates, thinking and the folder from sessions.describe", () => {
    expect(readDetail({ session: { verboseLevel: "full", reasoningLevel: "on", worktree: { path: "/w" } } })).toEqual({ verboseLevel: "full", showThinking: true, workspace: "/w" });
    expect(readDetail({ session: {} })).toEqual({ verboseLevel: "off", showThinking: true, workspace: null });
  });

  it("builds the conversation link on the window's own address and the public link on the engine's", () => {
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
