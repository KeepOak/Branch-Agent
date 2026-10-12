import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../connect/conversations";
import { ConversationRow } from "./ConversationRow";
import { SidebarPet } from "./SidebarPet";

vi.mock("../face/Pebble", () => ({ Pebble: () => <span>face</span> }));

const row: Conversation = {
  key: "agent:ada:main", title: "Ada", agentId: "ada", isMain: true, pinned: false,
  archived: false, unread: false, snoozedUntil: null, createdAt: 0, updatedAt: 0,
  preview: "Previous reply", working: true, kind: "trunk", system: false,
  automation: false, totalTokens: 0, contextTokens: 0, sessionId: "s1",
};

describe("P54 pet home and typing row", () => {
  it("shows one keeper for a selected pet and none when no pet is selected", () => {
    const shown = renderToStaticMarkup(<div className="pet-lane"><SidebarPet pet={{ id: "px-squirrel", name: "Pet" }} waiting={null} still /></div>);
    expect(shown).toContain('class="keeper"');
    expect(shown).toContain('class="pet-lane"');
    const hidden = renderToStaticMarkup(<div className="pet-lane empty"><SidebarPet pet={{ id: "none", name: "Pet" }} waiting={null} still /></div>);
    expect(hidden).not.toContain('class="keeper"');
  });

  it("shows the preview typing dots while the Trunk writes and no leading dot while waiting", () => {
    const render = (working: boolean) => renderToStaticMarkup(<ConversationRow row={row} current={false} time="now" showPreview state={{ working, waiting: false }} trunkName="Ada" onOpen={() => {}} onMenu={() => {}} />);
    expect(render(true)).toContain("typing…");
    expect(render(true)).toContain('class="rowTypT5"');
    expect(render(true)).not.toContain("Thinking");
    expect(render(true)).not.toContain("Previous reply");
    expect(render(false)).toContain("Previous reply");
    expect(render(false)).not.toContain("typing…");
    const waiting = renderToStaticMarkup(<ConversationRow row={row} current={false} time="now" showPreview state={{ working: true, waiting: true }} trunkName="Ada" onOpen={() => {}} onMenu={() => {}} />);
    expect(waiting).toContain("Waiting on you");
    expect(waiting).not.toContain("· Waiting on you");
  });
});
