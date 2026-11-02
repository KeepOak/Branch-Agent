// @vitest-environment jsdom
// Inside the Branch desktop app, Updates never tells the person to update or use "the Branch app" they are already in:
// a greyed Check now in an older app says this version checks on its own, and Window fixes without reinstalling says
// this app gets them with its own updates. In a browser both rows keep their old lines.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { forgetLookStore } from "../../places/settings/set1/appearance-store";
import { UpdatesBlock, UpdatesPage } from "../../places/settings/set2/updates";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEND_TO_APP = /the Branch app/;
const OLD_CHECK = "Update the Branch app to check by hand.";
const OLD_FIXES = "Small window fixes arrive with the Branch app’s updater.";
const LOCAL = "ws://127.0.0.1:18789/";

let host: HTMLDivElement;
let root: Root;

function engineAt(gatewayUrl: string): WindowEngine {
  const request = vi.fn(async (method: string) => {
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    return {};
  });
  return {
    gatewayUrl,
    request,
    onEvent: () => () => undefined,
    sessionKey: "s",
    scopes: ["operator.admin", "operator.write"],
  } as unknown as WindowEngine;
}
/** An older Branch app: it has the window bridge but no Check now (componentUpdates) bridge. */
function olderApp() {
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: LOCAL };
}
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
/** The words a person can meet in one row: its text and its tooltips. */
function rowWords(title: string): string {
  const row = [...host.querySelectorAll("[data-row]")].find(
    (el) => el.getAttribute("data-row") === title,
  );
  if (!row) throw new Error(`missing row ${title}`);
  return [
    row.textContent ?? "",
    ...[...row.querySelectorAll("[title]")].map((el) => el.getAttribute("title") ?? ""),
  ].join("\n");
}

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  localStorage.clear();
  forgetLookStore();
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  forgetLookStore();
  localStorage.clear();
});

describe("Settings > Updates inside the Branch app", () => {
  it("a greyed Check now in an older app says this version checks on its own, not to update the Branch app", async () => {
    olderApp();
    await act(async () =>
      root.render(
        <UpdatesPage page="updates" title="Updates" level="advanced" engine={engineAt(LOCAL)} />,
      ),
    );
    await flush();
    const check = [...host.querySelectorAll("button")].find((b) => b.textContent === "Check now");
    expect(check?.disabled).toBe(true);
    expect(rowWords("Check for updates")).toContain(
      "This version checks on its own. Checking by hand needs a newer version.",
    );
    expect(host.textContent).not.toContain(OLD_CHECK);
    expect(rowWords("Check for updates")).not.toMatch(SEND_TO_APP);
  });

  it("Window fixes without reinstalling says this app gets them with its own updates", async () => {
    olderApp();
    await act(async () =>
      root.render(
        <UpdatesBlock
          page="updates"
          title="Updates"
          level="advanced"
          engine={engineAt(LOCAL)}
          part="before"
        />,
      ),
    );
    await flush();
    const words = rowWords("Window fixes without reinstalling");
    expect(words).toContain("This app gets small window fixes with its own updates.");
    expect(words).not.toContain(OLD_FIXES);
    expect(words).not.toMatch(SEND_TO_APP);
  });

  it("connected to another computer's engine, Window fixes still never sends you to the Branch app", async () => {
    olderApp();
    await act(async () =>
      root.render(
        <UpdatesPage
          page="updates"
          title="Updates"
          level="advanced"
          engine={engineAt("ws://10.0.0.5:18789/")}
        />,
      ),
    );
    await flush();
    expect(rowWords("Window fixes without reinstalling")).not.toMatch(SEND_TO_APP);
    expect(host.textContent).not.toContain(OLD_FIXES);
  });
});

describe("Settings > Updates in a browser", () => {
  it("keeps the line that window fixes arrive with the Branch app's updater", async () => {
    await act(async () =>
      root.render(
        <UpdatesPage
          page="updates"
          title="Updates"
          level="advanced"
          engine={engineAt("ws://10.0.0.5:18789/")}
        />,
      ),
    );
    await flush();
    expect(rowWords("Window fixes without reinstalling")).toContain(OLD_FIXES);
    expect(host.textContent).not.toContain(
      "This app gets small window fixes with its own updates.",
    );
  });
});
