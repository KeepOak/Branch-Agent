// @vitest-environment jsdom
// Settings › General › Cover the screen (Private #1093 problem 1): Cover now has nothing behind it yet, so its row is
// Coming and, like every Coming row, shows only at Technical (rows.ts COMING_FROM). Regular and Advanced draw no Cover
// the screen card and no later-update button; Technical keeps the row with its keys and its Coming Cover button.
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

const LATER = "Cover the screen comes in a later update.";

it.each(["regular", "advanced"] as const)("shows no Cover the screen stub at %s", async (level) => {
  await mount(level);
  expect(host.querySelector('.r1s-sec[aria-label="Cover the screen"]')).toBeNull();
  expect(host.querySelector('[data-row="general.cover.now"]')).toBeNull();
  expect(host.querySelector('[data-coming="' + LATER + '"]')).toBeNull();
  expect(host.textContent).not.toContain("Cover now");
});

it("keeps Cover now at Technical, its Cover button Coming with the row's own words", async () => {
  await mount("technical");
  const row = host.querySelector<HTMLElement>('.r1s-sec[aria-label="Cover the screen"] [data-row="general.cover.now"]');
  expect(row).not.toBeNull();
  expect(row!.querySelector("b")!.textContent).toBe("Cover now");
  const button = row!.querySelector<HTMLButtonElement>("button.r1s-btn")!;
  expect(button.textContent).toBe("Cover");
  expect(button.getAttribute("data-coming")).toBe(LATER);
  expect(button.getAttribute("aria-disabled")).toBe("true");
});
