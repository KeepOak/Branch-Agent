import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationList } from "../connect/conversations";
import { conversationActions } from "./conversation-actions";
import { ConversationRow } from "./ConversationRow";
import { rowMenuItems } from "./row-menu";

vi.mock("../face/Face", () => ({ Face: () => null }));

const key = "agent:research:abc";
const row = (done: boolean): Conversation => ({
  key, sessionId: "session-1", title: "Research", agentId: "research", done,
  isMain: false, pinned: false, archived: false, unread: false, snoozedUntil: null,
  createdAt: 0, updatedAt: 0, preview: "", working: false, kind: "direct",
  system: false, automation: false, totalTokens: 0, contextTokens: 0,
});

function menu(done: boolean, actions: ReturnType<typeof conversationActions>) {
  return rowMenuItems(row(done), {
    actions, now: Date.now(), trunkName: "Research", level: "regular",
    open: () => {}, rename: () => {}, confirmDelete: () => {}, newWith: () => {},
    ask: () => {}, editTrunk: () => {}, tidy: () => {}, copyMarkdown: () => {},
    copyText: () => {}, copyLink: () => {},
  });
}

describe("conversation row Mark done", () => {
  it("Mark done calls sessions.patch with done:true and a done row offers Mark not done", async () => {
    const request = vi.fn(async () => ({ sessions: [] })) as Parameters<typeof conversationActions>[0];
    const actions = conversationActions(request, { refresh: vi.fn(async () => {}) } as unknown as ConversationList, () => null);
    const first = menu(false, actions).find((item) => item.kind === undefined && item.testid === "menu-done");
    expect(first).toMatchObject({ label: "Mark done" });
    expect(first && "disabled" in first ? first.disabled : undefined).toBeUndefined();
    if (first?.kind === undefined) first.run();
    expect(request).toHaveBeenCalledWith("sessions.patch", { key, agentId: "research", expectedSessionId: "session-1", done: true });

    const second = menu(true, actions).find((item) => item.kind === undefined && item.testid === "menu-done");
    expect(second).toMatchObject({ label: "Mark not done" });
    if (second?.kind === undefined) second.run();
    expect(request).toHaveBeenCalledWith("sessions.patch", { key, agentId: "research", expectedSessionId: "session-1", done: false });
  });
  it("shows a check after a done row name without changing an undone row", () => {
    const render = (done: boolean) => renderToStaticMarkup(<ConversationRow
      row={row(done)} current={false} time="now" showPreview={false}
      state={{ waiting: false, working: false }} trunkName="Research"
      onOpen={() => {}} onMenu={() => {}}
    />);
    expect(render(true)).toMatch(/Research<\/span><\/span><span class="bdg" title="Done"/);
    expect(render(false)).not.toContain('title="Done"');
  });
});
