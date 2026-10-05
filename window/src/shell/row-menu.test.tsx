import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConversationList, type Conversation } from "../connect/conversations";
import { conversationActions } from "./conversation-actions";
import { ConversationRow } from "./ConversationRow";
import { rowMenuItems } from "./row-menu";
import { Sidebar, type SidebarProps } from "./Sidebar";
import { buildSections, DEFAULT_PREFS } from "./list-model";

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
  it("refreshes the list after Mark done without waiting for an event", async () => {
    const request = vi.fn(async () => ({})) as Parameters<typeof conversationActions>[0];
    const refresh = vi.fn(async () => {});
    const actions = conversationActions(request, { refresh } as unknown as ConversationList, () => null);
    await actions.setDone(row(false), true);
    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key, agentId: "research", expectedSessionId: "session-1", done: true,
    });
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("shows Done in the Sidebar after a started list receives sessions.changed", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const request = vi.fn(async (method: string) =>
        method === "sessions.subscribe"
          ? { list: { sessions: [{ key, sessionId: "session-1", displayName: "Research", done }] } }
          : { sessions: [{ key, sessionId: "session-1", displayName: "Research", done }] },
      );
      const list = new ConversationList(request as ConstructorParameters<typeof ConversationList>[0], null);
      await list.start();
      const renderSidebar = () => {
        const rows = list.getSnapshot().rows;
        const props: SidebarProps = {
          home: null, sections: buildSections(rows, DEFAULT_PREFS, Date.now(), null), allRows: rows,
          openKey: null, currentPlace: null, now: Date.now(), showPreview: false,
          rowState: () => ({ waiting: false, working: false }), trunkName: () => "Research",
          inboxCount: 0, runningCount: 0, personName: "Owner", hasUnread: false,
          filterSlot: null, summary: null, emptyLine: null, search: null, searchResults: null,
          rail: false, onRailSearch: () => {}, onOpen: () => {}, onPlace: () => {},
          onNew: () => {}, onMenu: () => {}, onPin: () => {}, onArchive: () => {},
          onMarkAllRead: () => {}, onPerson: () => {}, onSettings: () => {},
        };
        return renderToStaticMarkup(<Sidebar {...props} />);
      };
      expect(renderSidebar()).not.toContain('title="Done"');
      done = true;
      list.onEvent("sessions.changed", { sessionKey: key });
      await vi.advanceTimersByTimeAsync(150);
      expect(request).toHaveBeenCalledWith("sessions.list", expect.any(Object));
      expect(renderSidebar()).toContain('title="Done"');
      list.stop();
    } finally {
      vi.useRealTimers();
    }
  });
  it("Mark done calls sessions.patch with done:true and a done row offers Mark not done", async () => {
    const request = vi.fn(async () => ({ sessions: [] })) as Parameters<typeof conversationActions>[0];
    const actions = conversationActions(request, { refresh: vi.fn(async () => {}) } as unknown as ConversationList, () => null);
    const first = menu(false, actions).find((item) => item.kind === undefined && item.testid === "menu-done");
    expect(first).toMatchObject({ label: "Mark done" });
    expect(first && "disabled" in first ? first.disabled : undefined).toBeUndefined();
    if (!first || first.kind !== undefined) throw new Error("Mark done action is missing");
    first.run();
    expect(request).toHaveBeenCalledWith("sessions.patch", { key, agentId: "research", expectedSessionId: "session-1", done: true });

    const second = menu(true, actions).find((item) => item.kind === undefined && item.testid === "menu-done");
    expect(second).toMatchObject({ label: "Mark not done" });
    if (!second || second.kind !== undefined) throw new Error("Mark not done action is missing");
    second.run();
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
