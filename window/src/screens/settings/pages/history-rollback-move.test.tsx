// @vitest-environment jsdom
// Settings › History & backups (Private #1093): Roll back and Move… are greyed until they are built, and each says why
// in a visible line the button names with aria-describedby, not only in a tooltip. A long data folder path is capped
// so it never squeezes the row's title and description into a narrow strip.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { HISTORY_ROWS } from "./history";
import { DataFolder, EveryChange } from "./history-live";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const LONG = "/srv/branch/Library/Application Support/Branch/agents/a-very-long-profile-name/.branch/state/data";
const METHODS = ["config.get", "users.prefs.get", "branch.changes.list", "system.info"];
function engineStub() {
  const request = vi.fn(async (method: string) => {
    if (method === "branch.changes.list") return { entries: [
      { id: "c1", source: "config-rpc", summary: "Changed the night window", at: Date.now(), kind: "config-write" },
      { id: "c2", source: "config-rpc", summary: "Changed the theme", at: Date.now(), kind: "config-write" },
    ] };
    if (method === "system.info") return { diskPath: LONG };
    if (method === "config.get") return { hash: "h", valid: true, config: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const row = (id: string) => HISTORY_ROWS.find((r) => r.id === id)!;
const buttons = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent?.trim() === text);
/** The visible line a control names with aria-describedby, or "" when it names none. */
const reasonOf = (el: Element | undefined) => {
  const id = el?.getAttribute("aria-describedby");
  const line = id ? document.getElementById(id) : null;
  return line && !line.closest("[hidden]") ? (line.textContent ?? "").trim() : "";
};

describe("History & backups: Roll back and Move… say why in a visible line", () => {
  it("Every change shows one reason line for the list, named by each greyed Roll back", async () => {
    await act(async () => root.render(<EveryChange engine={engineStub()} row={row("history.undo.changes")} />));
    await settle();
    const rollBacks = buttons("Roll back");
    expect(rollBacks).toHaveLength(2);
    for (const b of rollBacks) {
      expect(b.disabled).toBe(true);
      expect(reasonOf(b)).toBe("Rolling back a change comes in a later update. Until then, Import a saved settings file to go back.");
    }
    // One line for the whole list, not one per row.
    expect(new Set(rollBacks.map((b) => b.getAttribute("aria-describedby"))).size).toBe(1);
    expect(host.textContent?.split("comes in a later update").length).toBe(2);
  });

  it("Where your data lives: Move… names a visible reason, and the long path is capped with the full path as its tooltip", async () => {
    await act(async () => root.render(<DataFolder engine={engineStub()} row={row("history.copy.data")} />));
    await settle();
    const [move] = buttons("Move…");
    expect(move?.disabled).toBe(true);
    expect(reasonOf(move)).toBe("Moving your data folder comes in a later update.");
    expect(host.textContent).not.toContain("needs the Branch app");
    const code = host.querySelector<HTMLElement>("code")!;
    expect(code.textContent).toBe(LONG);
    expect(code.title).toBe(LONG);
    expect(code.style.textOverflow).toBe("ellipsis");
    expect(code.style.whiteSpace).toBe("nowrap");
    expect(code.style.maxWidth).toBe("100%");
    // The control column is capped, so it can't push the row's title and description into a narrow strip.
    expect(code.parentElement?.style.maxWidth).toBe("min(18rem, 42vw)");
  });
});
