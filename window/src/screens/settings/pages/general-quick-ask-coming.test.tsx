// @vitest-environment jsdom
// Settings › General › Quick ask: changing the Quick ask shortcut has nothing behind it yet (its Change… button is only
// Coming), so the row is Coming and, like every Coming row, shows only at Technical (rows.ts COMING_FROM). Regular and
// Advanced draw no Quick ask card and no later-update button; Technical keeps both rows, the shortcut first.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { forgetLookStore } from "../../../places/settings/set1/appearance-store";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engine(): WindowEngine {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "projects.list") return { projects: [] };
    if (method === "sessions.list") return { totalCount: 0, sessions: [] };
    if (method === "models.list") return { models: [] };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"] } as unknown as WindowEngine;
}

async function mount(level: "regular" | "advanced" | "technical") {
  localStorage.setItem("branch.level", level);
  await act(async () => root.render(<SettingsFrame engine={engine()} page="general" pages={R1_PAGES} />));
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const LATER = "Changing the quick ask shortcut comes in a later update.";

it.each(["regular", "advanced"] as const)("shows no Quick ask shortcut stub at %s", async (level) => {
  await mount(level);
  expect(host.querySelector('.r1s-sec[aria-label="Quick ask"]')).toBeNull();
  expect(host.querySelector('[data-row="general.quick-ask.shortcut"]')).toBeNull();
  expect(host.querySelector('[data-coming="' + LATER + '"]')).toBeNull();
  expect(host.textContent).not.toContain("Quick ask shortcut");
});

it("keeps the Quick ask card at Technical, its Change… button Coming with the row's own words", async () => {
  await mount("technical");
  const card = host.querySelector<HTMLElement>('.r1s-sec[aria-label="Quick ask"]')!;
  expect(card).not.toBeNull();
  expect([...card.querySelectorAll(".r1s-row > b")].map((b) => b.textContent)).toEqual(["Quick ask shortcut", "Quick ask from anywhere"]);
  const row = card.querySelector<HTMLElement>('[data-row="general.quick-ask.shortcut"]')!;
  const button = row.querySelector<HTMLButtonElement>("button.r1s-btn")!;
  expect(button.textContent).toBe("Change…");
  expect(button.getAttribute("data-coming")).toBe(LATER);
  expect(button.getAttribute("aria-disabled")).toBe("true");
});
