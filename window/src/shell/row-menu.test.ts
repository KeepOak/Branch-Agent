import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../connect/conversations";
import type { Contact } from "./contacts-model";
import { rowMenuItems, TRUNK_DELETE_OFF } from "./row-menu";

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
  const actions = { pin: vi.fn(), setUnread: vi.fn(), archive: vi.fn(), restore: vi.fn(), snooze: vi.fn() };
  const items = rowMenuItems(target, {
    actions: actions as never, now: 100, trunkName: "Oak", open: vi.fn(), rename, confirmDelete,
    newWith: vi.fn(), level: "regular", ask: vi.fn(), editTrunk: vi.fn(), tidy: vi.fn(),
    copyMarkdown: vi.fn(), copyText: vi.fn(), copyLink: vi.fn(), profile, contact: current,
    markContactRead: vi.fn(), pinContact: vi.fn(), whoItKnows: vi.fn(), toggleMute,
  });
  const run = (id: string) => {
    const item = items.find((candidate) => "testid" in candidate && candidate.testid === id);
    if (item && "run" in item && !item.disabled) item.run();
    return item;
  };
  return { items, run, rename, confirmDelete, profile, actions, toggleMute };
}

describe("contact and topic row menus", () => {
  it("never offers delete on the default Trunk and greys non-default Trunk delete", () => {
    const main = row("agent:oak:main", { kind: "trunk", isMain: true });
    expect(menu(main, contact("trunk", main, true)).run("menu-delete")).toBeUndefined();
    const other = row("agent:elm:main", { agentId: "elm", kind: "trunk" });
    const m = menu(other, contact("trunk", other));
    expect(m.run("menu-delete")).toMatchObject({ disabled: TRUNK_DELETE_OFF });
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
