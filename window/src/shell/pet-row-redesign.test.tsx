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
    const shown = renderToStaticMarkup(<div className="pet-lane"><SidebarPet pet={{ id: "px-squirrel", where: "status", name: "Pet" }} waiting={null} still /></div>);
    expect(shown).toContain('class="keeper"');
    expect(shown).toContain('class="pet-lane"');
    const hidden = renderToStaticMarkup(<div className="pet-lane empty"><SidebarPet pet={{ id: "none", where: "side", name: "Pet" }} waiting={null} still /></div>);
    expect(hidden).not.toContain('class="keeper"');
  });

  it("shows typing… in the contact row only while its real working state is active", () => {
    const render = (working: boolean) => renderToStaticMarkup(<ConversationRow row={row} current={false} time="now" showPreview state={{ working, waiting: false }} trunkName="Ada" onOpen={() => {}} onMenu={() => {}} />);
    expect(render(true)).toContain("typing…");
    expect(render(true)).not.toContain("Previous reply");
    expect(render(false)).toContain("Previous reply");
    expect(render(false)).not.toContain("typing…");
  });
});
