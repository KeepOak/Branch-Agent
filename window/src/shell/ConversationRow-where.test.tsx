// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../connect/conversations";
import { ConversationRow } from "./ConversationRow";

// The avatar records the props it was given, so the test can read the computer it is keyed on.
vi.mock("../face/Pebble", () => ({ Pebble: (props: { where?: string; label?: string }) => <span data-where={props.where} data-label={props.label}>face</span> }));

const row: Conversation = {
  key: "agent:juniper:main", title: "Juniper", agentId: "juniper", isMain: true, pinned: false,
  archived: false, unread: false, snoozedUntil: null, createdAt: 0, updatedAt: 0,
  preview: "", working: false, kind: "trunk", system: false,
  automation: false, totalTokens: 0, contextTokens: 0, sessionId: "s1",
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

async function render(where?: string) {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<ConversationRow row={row} current={false} time="now" showPreview={false} state={{ working: false, waiting: false }} trunkName="Juniper" where={where} onOpen={() => {}} onMenu={() => {}} />));
  return host.querySelector<HTMLElement>("[data-where]");
}

describe("a conversation row's avatar knows the computer its agent is on", () => {
  it("passes the row's where to the avatar, so same-named agents can get their own looks", async () => {
    expect((await render("Mac mini"))?.dataset.where).toBe("Mac mini");
  });

  it("passes nothing when the agent's computer is unknown, so the name-only look applies", async () => {
    expect((await render())?.dataset.where).toBeUndefined();
  });
});
