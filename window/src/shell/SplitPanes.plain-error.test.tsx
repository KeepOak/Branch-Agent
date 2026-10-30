// @vitest-environment jsdom
// A split pane's conversation error is one plain sentence at Regular, exact words at Advanced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Conversation } from "../connect/conversations";
import { SplitPanes } from "./SplitPanes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|19031/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:19031";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

const row: Conversation = {
  key: "agent:main:chat", title: "Chat", agentId: "main", isMain: true, pinned: false, archived: false,
  unread: false, snoozedUntil: null, createdAt: 0, updatedAt: 0, preview: "", working: false,
  kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0,
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };

function renderPane() {
  return (
    <SplitPanes
      panes={[{ key: row.key, dir: "right" }]}
      rows={[row]}
      openKey={null}
      request={async () => { throw new Error(ENGINE); }}
      onEvent={() => () => undefined}
      trunkName={() => "Main"}
      rowName={() => "Chat"}
      onOpen={() => undefined}
      onPick={() => undefined}
      onClose={() => undefined}
      onMenu={() => undefined}
      onSplit={() => undefined}
    />
  );
}

describe("a split pane never shows a raw engine error at Regular", () => {
  it("names a failed history read in a plain sentence", async () => {
    await act(async () => root.render(renderPane()));
    await settle();
    const line = host.querySelector(".talk-error")?.textContent ?? "";
    expect(line).toBe(REACH);
    expect(line).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(renderPane()));
    await settle();
    expect(host.querySelector(".talk-error")?.textContent).toBe(ENGINE);
  });
});
