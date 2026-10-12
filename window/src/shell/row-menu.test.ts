import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../connect/conversations";
import type { Contact } from "./contacts-model";
import { rowMenuItems, threadMenuItems } from "./row-menu";

const row = (key: string, extra: Partial<Conversation> = {}): Conversation => ({
  key, title: "Oak", agentId: "oak", isMain: false, pinned: false, archived: false, unread: false,
  snoozedUntil: null, createdAt: 1, updatedAt: 1, preview: "", working: false, kind: "direct",
  system: false, automation: false, totalTokens: 0, contextTokens: 0, ...extra,
});
const contact = (kind: Contact["kind"], thread: Conversation, isDefault = false): Contact => ({
  id: `${kind}:${thread.key}`, kind, name: thread.title, threadKey: thread.key, isDefault,
  lastActivityAt: 1, preview: { kind: "message", text: "", at: 1 }, unreadTopics: 0,
    threadUnread: false, needsYou: false, working: false, topicCount: 0, thread,
});

function menu(target: Conversation, current?: Contact) {
  const rename = vi.fn();
  const confirmDelete = vi.fn();
  const profile = vi.fn();
  const toggleMute = vi.fn();
  const removeTrunk = vi.fn();
  const ownWindow = vi.fn();
  const actions = { pin: vi.fn(), setUnread: vi.fn(), archive: vi.fn(), restore: vi.fn(), snooze: vi.fn() };
  const items = rowMenuItems(target, {
    actions: actions as never, now: 100, trunkName: "Oak", open: vi.fn(), ownWindow, rename, confirmDelete,
    level: "regular", ask: vi.fn(), editTrunk: vi.fn(), tidy: vi.fn(),
    copyMarkdown: vi.fn(), copyText: vi.fn(), copyLink: vi.fn(), copyConversation: vi.fn(), profile, contact: current,
    markContactRead: vi.fn(), pinContact: vi.fn(), whoItKnows: vi.fn(), toggleMute, removeTrunk,
  });
  const run = (id: string) => {
    const item = items.find((candidate) => "testid" in candidate && candidate.testid === id);
    if (item && "run" in item && !item.disabled) item.run();
    return item;
  };
  return { items, run, rename, confirmDelete, profile, actions, toggleMute, removeTrunk, ownWindow };
}

describe("contact and topic row menus", () => {
  it("opens contact threads and topics in a separate window", () => {
    const thread = row("agent:oak:main", { isMain: true });
    const main = menu(thread, contact("trunk", thread, true));
    expect(main.run("menu-own-window")).toMatchObject({ label: "Open in its own window" });
    expect(main.ownWindow).toHaveBeenCalledWith(thread.key);
    const topic = row("agent:oak:topic");
    const child = menu(topic);
    child.run("menu-own-window");
    expect(child.ownWindow).toHaveBeenCalledWith(topic.key);
  });
  it("offers to show an already popped-out conversation", () => {
    const thread = row("agent:oak:main", { isMain: true });
    const ownWindow = vi.fn();
    const items = rowMenuItems(thread, {
      actions: {} as never, now: 100, trunkName: "Oak", open: vi.fn(), ownWindow,
      ownWindowOpen: (key) => key === thread.key,
      rename: vi.fn(), confirmDelete: vi.fn(), level: "regular", ask: vi.fn(), editTrunk: vi.fn(),
      tidy: vi.fn(), copyMarkdown: vi.fn(), copyText: vi.fn(), copyLink: vi.fn(), copyConversation: vi.fn(),
    });
    const item = items.find((candidate) => "testid" in candidate && candidate.testid === "menu-own-window");
    expect(item).toMatchObject({ label: "Show its window" });
    if (item && "run" in item) item.run();
    expect(ownWindow).toHaveBeenCalledWith(thread.key);
  });
  it("matches the final-pass row-menu changes without the duplicate new-conversation action", () => {
    const main = row("agent:oak:main", { kind: "trunk", isMain: true });
    const items = menu(main, contact("trunk", main, true)).items;
    const labels = (entries: typeof items) => entries.map((item) => "label" in item ? item.label : null).filter(Boolean);
    expect(labels(items)).toContain("What can Oak do?");
    expect(labels(items)).toContain("Mark done");
    expect(labels(items)).not.toContain("New conversation with Oak");
    const topic = menu(row("agent:oak:topic")).items;
    expect(labels(topic)).toContain("Snooze");
    expect(labels(topic)).not.toContain("New conversation with Oak");
  });
  it("only offers Remove on a non-default Trunk", () => {
    const main = row("agent:oak:main", { kind: "trunk", isMain: true });
    expect(menu(main, contact("trunk", main, true)).run("menu-delete")).toBeUndefined();
    expect(menu(main, contact("trunk", main, true)).run("menu-remove-trunk")).toBeUndefined();
    const other = row("agent:elm:main", { agentId: "elm", kind: "trunk" });
    const m = menu(other, contact("trunk", other));
    expect(m.run("menu-delete")).toBeUndefined();
    expect(m.run("menu-remove-trunk")).toMatchObject({ label: "Remove Oak…" });
    expect(m.removeTrunk).toHaveBeenCalledWith("elm", "Oak");
    expect(m.confirmDelete).not.toHaveBeenCalled();
    m.run("menu-rename");
    expect(m.profile).toHaveBeenCalledWith("elm");
  });

  it.each(["chatGroup", "outside"] as const)("keeps rename, archive and delete live for %s contacts", (kind) => {
    const thread = row(`agent:oak:${kind}:one`, { kind });
    const m = menu(thread, contact(kind, thread));
    m.run("menu-rename"); m.run("menu-archive"); m.run("menu-delete");
    expect(m.rename).toHaveBeenCalledWith(thread);
    expect(m.actions.archive).toHaveBeenCalledWith(thread);
    expect(m.confirmDelete).toHaveBeenCalledWith(thread);
  });

  it("keeps the existing topic actions live", () => {
    const topic = row("agent:oak:topic");
    const m = menu(topic);
    m.run("menu-rename"); m.run("menu-archive"); m.run("menu-delete");
    expect(m.rename).toHaveBeenCalledWith(topic);
    expect(m.actions.archive).toHaveBeenCalledWith(topic);
    expect(m.confirmDelete).toHaveBeenCalledWith(topic);
  });

  it("mutes a contact without changing its unread state", () => {
    const thread = row("agent:oak:main", { unread: true });
    const target = contact("trunk", thread, true);
    const m = menu(thread, target);
    expect(m.run("menu-mute")).toMatchObject({ label: "Mute" });
    expect(m.toggleMute).toHaveBeenCalledWith(target);
    expect(thread.unread).toBe(true);
  });
});

describe("thread right-click menu", () => {
  it("offers Rename, Pin, Mark read and Archive, with the words the row menu uses", () => {
    const actions = { pin: vi.fn(), setUnread: vi.fn(), archive: vi.fn(), restore: vi.fn() } as unknown as Parameters<typeof threadMenuItems>[1]["actions"];
    const rename = vi.fn();
    const items = threadMenuItems(row("t1", { unread: true }), { actions, rename });
    expect(items.map((i) => ("label" in i ? i.label : "-"))).toEqual(["Rename", "Pin", "Mark as read", "Archive"]);
    expect(threadMenuItems(row("t2", { pinned: true, archived: true }), { actions, rename }).map((i) => ("label" in i ? i.label : "-"))).toEqual(["Rename", "Unpin", "Mark as unread", "Restore"]);
    const first = items[0];
    if ("run" in first) first.run();
    expect(rename).toHaveBeenCalledWith(expect.objectContaining({ key: "t1" }));
  });
});
