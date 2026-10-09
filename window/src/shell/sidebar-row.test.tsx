// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../connect/conversations";
import { CharacterFace } from "../face/CharacterFace";
import { ConversationRow } from "./ConversationRow";
import { Sidebar, type SidebarProps } from "./Sidebar";
import { ThreadColumn } from "./ThreadColumn";
import { TopicRail } from "./TopicRail";
import {
  MAIN_ARCHIVE_REASON,
  archiveOffer,
  isRawId,
  rowCardPosition,
  rowDisplayName,
  rowInitial,
  sidebarRailForOpen,
  threadCountLabel,
  type Box,
} from "./sidebar-row";

vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("../face/Pebble", () => ({ Pebble: () => null }));
vi.mock("../rooms/RoomFaces", () => ({ RoomFaces: () => <span className="rm-stack" /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const conversation = (partial: Partial<Conversation> & Pick<Conversation, "key" | "title">): Conversation => ({
  agentId: "local", isMain: false, pinned: false, archived: false, unread: false, snoozedUntil: null,
  createdAt: 1, updatedAt: 2, preview: "Latest line", working: false, kind: "trunk",
  system: false, automation: false, totalTokens: 0, contextTokens: 0,
  ...partial,
});

function sidebarProps(rows: Conversation[], extra: Partial<SidebarProps> = {}): SidebarProps {
  return {
    home: rows[0] ?? null,
    sections: [{ id: "recent", label: "Recent", rows }],
    openKey: null, currentPlace: null, now: 3, showPreview: true,
    rowState: () => ({ waiting: false, working: false }),
    trunkName: (id) => (id === "local" ? "Local Trunk" : "Remote computer"),
    personName: "Owner", hasUnread: false, filterSlot: null, summary: null, emptyLine: null,
    search: null, searchResults: null, rail: false, onRailSearch: () => {}, onOpen: () => {},
    onNew: () => {}, onMenu: () => {}, onPin: () => {}, onArchive: () => {}, onMarkAllRead: () => {},
    onPerson: () => {}, onSettings: () => {},
    ...extra,
  };
}

async function showSidebar(props: SidebarProps) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Sidebar {...props} />));
  return host;
}

describe("recent rows offer the same archive action", () => {
  it("shows Archive on the local Trunk, disabled, with the reason, and a working Archive on every other row", async () => {
    const local = conversation({ key: "agent:local:main", title: "Local Trunk", agentId: "local", isMain: true });
    const remote = conversation({ key: "agent:remote:main", title: "Remote computer", agentId: "remote", kind: "outside" });
    const archived = vi.fn();
    const host = await showSidebar(sidebarProps([local, remote], { onArchive: archived }));
    const localArchive = host.querySelector<HTMLButtonElement>('[data-key="agent:local:main"] [aria-label="Archive"]');
    const remoteArchive = host.querySelector<HTMLButtonElement>('[data-key="agent:remote:main"] [aria-label="Archive"]');
    expect(localArchive).toBeTruthy();
    expect(localArchive?.disabled).toBe(true);
    expect(localArchive?.title).toBe(MAIN_ARCHIVE_REASON);
    expect(host.querySelector('[data-key="agent:local:main"] [aria-label="Pin"]')).toBeTruthy();
    expect(host.querySelector('[data-key="agent:local:main"] [aria-label="More"]')).toBeTruthy();
    expect(remoteArchive?.disabled).toBe(false);
    await act(async () => localArchive?.click());
    expect(archived).not.toHaveBeenCalled();
    await act(async () => remoteArchive?.click());
    expect(archived).toHaveBeenCalledWith(expect.objectContaining({ key: "agent:remote:main" }));
    expect(archiveOffer(local, local.key, false)).toMatchObject({ visible: true, disabled: true, title: MAIN_ARCHIVE_REASON });
    expect(archiveOffer(remote, local.key, false)).toMatchObject({ visible: true, disabled: false });
  });
});

describe("opening a row keeps the full sidebar", () => {
  it("opens the local Trunk and any other row through the same full-list action", async () => {
    const local = conversation({ key: "agent:local:main", title: "Local Trunk", isMain: true });
    const remote = conversation({ key: "agent:remote:main", title: "Remote computer", agentId: "remote", kind: "outside" });
    const opened = vi.fn();
    const host = await showSidebar(sidebarProps([local, remote], { onOpen: opened }));
    await act(async () => host.querySelector<HTMLButtonElement>('[data-key="agent:local:main"] .row-open')?.click());
    await act(async () => host.querySelector<HTMLButtonElement>('[data-key="agent:remote:main"] .row-open')?.click());
    expect(opened.mock.calls.map((call) => call[0])).toEqual(["agent:local:main", "agent:remote:main"]);
    expect(host.querySelector("[data-testid=sidebar]")?.classList.contains("rail")).toBe(false);
    expect(sidebarRailForOpen(false, { hasTopics: true, wide: true, topicLayout: "column" })).toBe(false);
    expect(sidebarRailForOpen(true, { hasTopics: true, wide: true, topicLayout: "rail" })).toBe(true);
    const source = readFileSync(join(process.cwd(), "src/shell/WindowShell.tsx"), "utf8");
    expect(source).toContain("sidebarRailForOpen(");
    expect(source).not.toContain("topicAutoRail");
  });
});

describe("hover card replaces the native title and stays off the list", () => {
  it("omits the native title when the custom card is on, and keeps it in the icon rail", () => {
    const row = conversation({ key: "agent:local:main", title: "Local Trunk" });
    const withCard = renderToStaticMarkup(<ConversationRow row={row} current={false} time="now" showPreview state={{ waiting: false, working: false }} trunkName="Local Trunk" onOpen={() => {}} onMenu={() => {}} onCard={() => {}} />);
    expect(withCard).not.toContain('title="Local Trunk"');
    const rail = renderToStaticMarkup(<ConversationRow row={row} current rail={true} time="now" showPreview state={{ waiting: false, working: false }} trunkName="Local Trunk" onOpen={() => {}} onMenu={() => {}} onCard={() => {}} />);
    expect(rail).toContain('title="Local Trunk"');
  });

  it("places the card beside the list and the thread pane, never on top of either", () => {
    const sidebar: Box = { left: 0, top: 0, right: 280, bottom: 800 };
    const thread: Box = { left: 280, top: 0, right: 560, bottom: 800 };
    const anchor: Box = { left: 16, top: 140, right: 260, bottom: 200 };
    const pos = rowCardPosition({ anchor, sidebar, thread, card: { width: 300, height: 120 }, viewport: { width: 1280, height: 800 } });
    const card = { left: pos.left, top: pos.top, right: pos.left + 300, bottom: pos.top + 120 };
    expect(card.left).toBeGreaterThanOrEqual(thread.right);
    expect(card.left < sidebar.right && card.right > sidebar.left).toBe(false);
    expect(card.left < thread.right && card.right > thread.left).toBe(false);
    expect(pos.left).not.toBe(anchor.left + 24);
  });
});

describe("a selected row does not paint a garbled mark", () => {
  it("keeps the name as text and drops an unknown dotted icon", () => {
    const row = conversation({ key: "agent:remote:main", title: "Coordinator", agentId: "remote", icon: "-.-.-", kind: "outside" });
    const html = renderToStaticMarkup(<ConversationRow row={row} current time="now" showPreview={false} state={{ waiting: false, working: false }} trunkName="Remote computer" onOpen={() => {}} onMenu={() => {}} />);
    expect(html).toContain(">Coordinator<");
    expect(html).not.toContain("-.-.-");
    const frame = readFileSync(join(process.cwd(), "src/shell/frame.css"), "utf8");
    const nameRule = frame.match(/\.row-name\s*\{[^}]+\}/)?.[0] ?? "";
    expect(nameRule).not.toContain("text-overflow");
    const rows = readFileSync(join(process.cwd(), "src/shell/rows.css"), "utf8");
    expect(rows).toMatch(/\.nm-t\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
});

describe("every recent row has an avatar or an initial", () => {
  it("draws a themed initial when the face is missing", async () => {
    const row = conversation({ key: "agent:local:main", title: "Local Trunk" });
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<ConversationRow row={row} current={false} time="now" showPreview state={{ waiting: false, working: false }} trunkName="Local Trunk" onOpen={() => {}} onMenu={() => {}} />));
    const initial = host.querySelector(".row-initial");
    expect(initial?.textContent).toBe("L");
    expect(rowInitial("Local Trunk")).toBe("L");
    const css = readFileSync(join(process.cwd(), "src/shell/rows.css"), "utf8");
    const rule = css.match(/\.row-initial\s*\{[^}]+\}/)?.[0] ?? "";
    expect(rule).toContain("var(--fill-2)");
    expect(rule).toContain("var(--ink)");
    expect(rule).toContain("var(--sans)");
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(css).toContain(".character-face:not(.broken)");
  });

  it("marks a character face broken when its picture fails, so the initial can show", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<CharacterFace appearance={{ still: "/missing.webp" }} size={40} label="Local Trunk" />));
    const img = host.querySelector("img");
    expect(img).toBeTruthy();
    await act(async () => img?.dispatchEvent(new Event("error")));
    expect(host.querySelector(".character-face")?.classList.contains("broken")).toBe(true);
  });
});

describe("recent rows show a display name", () => {
  it("replaces a colon-separated id with the Trunk name", async () => {
    expect(isRawId("agent:researcher:main")).toBe(true);
    expect(isRawId("Fix: sidebar labels")).toBe(false);
    expect(rowDisplayName("agent:researcher:main", "Local Trunk")).toBe("Local Trunk");
    expect(rowDisplayName("agent:researcher:main", "")).toBe("Researcher");
    expect(rowDisplayName("agent:researcher:main", "agent:researcher:main")).toBe("Researcher");
    expect(rowDisplayName("Remote computer", "Remote computer")).toBe("Remote computer");
    const row = conversation({ key: "agent:researcher:main", title: "agent:researcher:main", agentId: "local" });
    const host = await showSidebar(sidebarProps([row]));
    expect(host.querySelector(".nm-t")?.textContent).toBe("Local Trunk");
    expect(host.querySelector(".nm-t")?.textContent).not.toContain(":");
  });
});

describe("the thread header counts General", () => {
  it("counts General when the topic list is empty, and adds each topic", async () => {
    expect(threadCountLabel(0)).toBe("1 thread");
    expect(threadCountLabel(1)).toBe("2 threads");
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<ThreadColumn name="Remote computer" generalKey="agent:remote:main" openKey="agent:remote:main" items={[]} onOpen={() => {}} />));
    expect(host.querySelector(".v23-threads-head small")?.textContent).toBe("1 thread");
    expect(host.textContent).toContain("General");
    await act(async () => root!.render(<ThreadColumn name="Remote computer" generalKey="agent:remote:main" openKey="agent:remote:main" items={[{ topic: { key: "agent:remote:notes", contactId: "trunk:remote", title: "Notes", status: "active", unread: false }, preview: "Hello", updatedAt: 1 }]} onOpen={() => {}} />));
    expect(host.querySelector(".v23-threads-head small")?.textContent).toBe("2 threads");
  });

  it("counts General in the topic column header too", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<TopicRail contactId="trunk:remote" contactName="Remote computer" contactKey="agent:remote:main" generalPreview="Hello" generalUpdatedAt={1} currentKey="agent:remote:main" items={[]} onOpen={() => {}} onAll={() => {}} onPatch={async () => {}} />));
    expect(host.querySelector(".tpHeadT5 small")?.textContent).toBe("1 thread");
  });
});
