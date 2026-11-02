// @vitest-environment jsdom
// Settings › Developer › System has no Status line row at any level: neither the Branch app nor the engine has a
// status line style to choose, so a greyed row there sent people to a setting that does not exist.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsPage } from "../../../places/settings/index";
import { SEC_ROWS } from "../../../places/settings/set2/developer-more";
import { SettingsFrame } from "../SettingsFrame";
import { DEVELOPER } from "./developer";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "system.info", "plugins.list", "audit.list"];
function engineOf(): WindowEngine {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
}
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const LEVELS = ["regular", "advanced", "technical"] as const;
const statusLineRows = () => [...host.querySelectorAll<HTMLElement>("[data-row]")].filter((r) => /status line/i.test(r.getAttribute("data-row") ?? "") || /status line/i.test(r.textContent ?? ""));

describe("Settings › Developer has no Status line row", () => {
  for (const level of LEVELS) {
    it("draws no Status line row and no Branch app reason for it in the new Settings at " + level, async () => {
      localStorage.setItem("branch.level", level);
      await act(async () => root.render(<SettingsFrame engine={engineOf()} page="developer" pages={R1_PAGES} />));
      await settle();
      expect(statusLineRows()).toEqual([]);
      expect(host.textContent ?? "").not.toMatch(/status line/i);
      expect(host.textContent ?? "").not.toMatch(/my script/i);
    });
  }

  it("keeps the System card, with its working rows, at Technical", async () => {
    localStorage.setItem("branch.level", "technical");
    await act(async () => root.render(<SettingsFrame engine={engineOf()} page="developer" pages={R1_PAGES} />));
    await settle();
    const system = host.querySelector<HTMLElement>('section.r1s-sec[aria-label="System"]');
    expect(system).toBeTruthy();
    expect(system?.textContent).toContain("Diagnostics");
    expect(system?.textContent).toContain("Find Branch on other computers nearby");
    expect(system?.textContent).not.toMatch(/status line/i);
    expect(system?.textContent).not.toContain("Set in the Branch app on this computer");
  });

  it("draws no Status line row in the classic Developer page at Technical", async () => {
    await act(async () => root.render(<SettingsPage page="developer" title="Developer" level="technical" engine={engineOf()} />));
    await settle();
    expect(statusLineRows()).toEqual([]);
    expect(host.textContent ?? "").not.toMatch(/status line/i);
  });

  it("lists no Status line row for search or the page plan", () => {
    const titles = [...SEC_ROWS.values()].flatMap(([, t]) => t);
    expect(titles).toContain("Diagnostics");
    expect(titles.filter((t) => /status line/i.test(t))).toEqual([]);
    expect((DEVELOPER.rows ?? []).filter((r) => /status line/i.test(String(r.label)))).toEqual([]);
  });
});
