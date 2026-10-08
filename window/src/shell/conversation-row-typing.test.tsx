import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Conversation } from "../connect/conversations";
import { ConversationRow, type RowExtras } from "./ConversationRow";

vi.mock("../face/Pebble", () => ({ Pebble: () => <span>face</span> }));
vi.mock("../rooms/RoomFaces", () => ({ RoomFaces: () => <span>faces</span> }));

const base: Conversation = {
  key: "agent:ada:main", title: "Ada", agentId: "ada", isMain: true, pinned: false,
  archived: false, unread: false, snoozedUntil: null, createdAt: 0, updatedAt: 0,
  preview: "Previous reply", working: true, kind: "trunk", system: false,
  automation: false, totalTokens: 0, contextTokens: 0, sessionId: "s1",
};

const extras = (partial: Partial<RowExtras> = {}): RowExtras => ({
  draft: false, waitingToSend: 0, advanced: false, headlines: true, liveInList: true, nameOf: () => "",
  ...partial,
});

function render(row: Conversation, state = { working: true, waiting: false }, more: { extras?: RowExtras; trunkName?: string } = {}) {
  return renderToStaticMarkup(
    <ConversationRow row={row} current={false} time="now" showPreview state={state} trunkName={more.trunkName ?? "Ada"} extras={more.extras} onOpen={() => {}} onMenu={() => {}} />,
  );
}

describe("conversation row typingRowsT5", () => {
  it("shows the preview's dots and typing… while a reply is written", () => {
    const html = render(base);
    expect(html).toContain('data-testid="row-typing"');
    expect(html).toContain('class="rowTypT5"');
    expect(html).toContain('aria-label="typing"');
    expect(html.match(/<i><\/i>/g)?.length).toBe(3);
    expect(html).toContain("typing…");
    expect(html).not.toContain("Thinking");
    expect(html).not.toContain("Previous reply");
    expect(html).not.toContain("whoTypT5");
  });

  it("keeps a live headline when that list setting is on", () => {
    const html = render({ ...base, headline: "Reading the invoice" }, undefined, { extras: extras() });
    expect(html).toContain("Reading the invoice");
    expect(html).not.toContain("typing…");
    expect(html).not.toContain('class="rowTypT5"');
  });

  it("keeps the last preview when headlines in the list are off", () => {
    const html = render(base, undefined, { extras: extras({ headlines: false }) });
    expect(html).toContain("Previous reply");
    expect(html).not.toContain("typing…");
  });

  it("shows typing… when headlines are off and the preview is still the writing ellipsis", () => {
    const html = render({ ...base, preview: "…" }, undefined, { extras: extras({ headlines: false }) });
    expect(html).toContain("typing…");
    expect(html).toContain('class="rowTypT5"');
  });

  it("keeps a group row on dots and typing… with no whoTypT5 name", () => {
    const html = render({
      ...base, key: "agent:ada:room", title: "Quotes", kind: "group",
      roomPicks: [{ kind: "trunk", name: "Dana" }, { kind: "trunk", name: "Ada" }],
    }, undefined, { trunkName: "Ada" });
    expect(html).toContain('class="rowTypT5"');
    expect(html).toContain("typing…");
    expect(html).not.toContain("whoTypT5");
    expect(html).not.toContain("Dana is typing…");
    expect(html).not.toContain("Ada is typing…");
  });

  it("leaves a finished row on its last preview", () => {
    const html = render(base, { working: false, waiting: false });
    expect(html).toContain("Previous reply");
    expect(html).not.toContain("typing…");
    expect(html).not.toContain('class="rowTypT5"');
  });
});
