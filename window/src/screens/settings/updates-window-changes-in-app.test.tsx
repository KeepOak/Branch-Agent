// @vitest-environment jsdom
// Inside the Branch desktop app, the Window changes row on Updates says what this app does (it swaps in a new
// window by itself and keeps your draft and place) instead of sending you to "the Branch app" you are already in.
// In a browser the row keeps its old line.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { forgetLookStore } from "../../places/settings/set1/appearance-store";
import { UpdatesBlock, UpdatesPage } from "../../places/settings/set2/updates";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEND_TO_APP = /the Branch app/;
const OLD_SWAP = "Swapping the window in place is done by the Branch app.";
const IN_APP_SWAP = "This app swaps in a new window by itself and keeps your draft and place.";
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
/** Inside the Branch app: the window has the app's bridge. */
function inTheApp() {
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

describe("Settings > Updates > Window changes inside the Branch app", () => {
  it("says this app swaps in a new window by itself, not that the Branch app does it", async () => {
    inTheApp();
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
    const words = rowWords("Window changes");
    expect(words).toContain(IN_APP_SWAP);
    expect(words).not.toContain(OLD_SWAP);
    expect(words).not.toMatch(SEND_TO_APP);
  });

  it("connected to another computer's engine, the row still never sends you to the Branch app", async () => {
    inTheApp();
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
    expect(rowWords("Window changes")).not.toMatch(SEND_TO_APP);
    expect(host.textContent).not.toContain(OLD_SWAP);
  });
});

describe("Settings > Updates > Window changes in a browser", () => {
  it("keeps the line that the Branch app swaps the window in place", async () => {
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
    expect(rowWords("Window changes")).toContain(OLD_SWAP);
    expect(host.textContent).not.toContain(IN_APP_SWAP);
  });
});
