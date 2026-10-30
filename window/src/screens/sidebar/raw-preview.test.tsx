// @vitest-environment jsdom
// Private #1089: no raw internal text reaches the sidebar. A topic the engine couldn't name comes titled with its session
// key, and the row's preview line put that key in front of the text ("agent:cedar:trunk:birch: ").
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Contact } from "../../shell/contacts-model";
import { contactRows, topicPreview } from "./model";
import { SideRowView } from "./parts";

vi.mock("../../face/Face", () => ({ Face: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const trunk = (title: string, text: string): Contact => ({
  id: "trunk:cedar", kind: "trunk", name: "Cedar", threadKey: "agent:cedar:main", isDefault: false, lastActivityAt: 10,
  preview: { kind: "topic", topicKey: "agent:cedar:trunk:birch", title, text, at: 10 },
  unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 1, thread: null,
} as Contact);

function shown(contact: Contact): string {
  const [row] = contactRows([contact], new Map(), () => []);
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root!.render(<SideRowView row={row} current={false} now={20} handlers={{ onOpen: vi.fn(), onMenu: vi.fn() }} />));
  return container.textContent ?? "";
}

describe("sidebar preview line (Private #1089)", () => {
  it("never shows a topic's session key", () => {
    const text = shown(trunk("agent:cedar:trunk:birch", "Tests pass"));
    expect(text).toContain("Tests pass");
    expect(text).not.toMatch(/agent:/);
    expect(text).not.toContain("trunk:birch");
  });

  it("shows nothing raw when the unnamed topic has no text yet", () => {
    const text = shown(trunk("agent:cedar:trunk:birch", ""));
    expect(text).not.toMatch(/agent:|:\s*$/);
  });

  it("keeps a real topic name in front of its text", () => {
    expect(shown(trunk("Inbox sweep", "Stopped"))).toContain("Inbox sweep: Stopped");
    expect(topicPreview("Re: invoices", "Sent")).toBe("Re: invoices: Sent");
  });
});
