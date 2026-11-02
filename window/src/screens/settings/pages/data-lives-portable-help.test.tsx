// @vitest-environment jsdom
// Where your data lives, in Settings › History & backups and in the Classic About Branch page, names no Portable mode
// at any level: Developer › System no longer draws a Portable mode row, so help that sent people there pointed at a
// setting that does not exist. The help keeps what Move… does. Regular and Advanced draw no Move… row.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider } from "../../../places/settings/kit";
import { SelfPage } from "../../../places/settings/set2/self";
import { SettingsFrame } from "../SettingsFrame";
import { HISTORY_ROWS } from "./history";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const FOLDER = "/srv/branch/data";
const MOVES = "Moves conversations, memory and settings together.";
const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "branch.changes.list", "system.info",
  "backup.status", "backup.schedule.set", "backup.schedule.clear", "backup.run", "doctor.memory.status", "doctor.memory.dreamDiary", "agents.list"];
function engineStub(): WindowEngine {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "branch.changes.list") return { entries: [] };
    if (method === "system.info") return { diskPath: FOLDER };
    if (method === "agents.list") return { agents: [] };
    return { ok: true };
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
}
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const LEVELS = [["regular", 0], ["advanced", 1], ["technical", 2]] as const;
const noPortable = (text: string) => { expect(text).not.toMatch(/portable mode/i); expect(text).not.toMatch(/beside the program/i); };

describe("Where your data lives names no Portable mode at any level", () => {
  it("History's row lists no Portable mode in its help", () => {
    const row = HISTORY_ROWS.find((r) => r.id === "history.copy.data");
    expect(row).toBeTruthy();
    noPortable(JSON.stringify(row));
  });

  for (const [level] of LEVELS) {
    it("Settings › History & backups at " + level, async () => {
      localStorage.setItem("branch.level", level);
      await act(async () => root.render(<SettingsFrame engine={engineStub()} page="history" pages={R1_PAGES} />));
      await settle();
      noPortable(document.body.textContent ?? "");
    });
  }

  for (const [level, lv] of LEVELS) {
    it("Classic About Branch, Your settings, with its page help open, at " + level, async () => {
      await act(async () => root.render(
        <KitProvider level={lv} report={{ saving: () => undefined, saved: () => undefined, failed: () => undefined }} scope={null}>
          <SelfPage page="self" title="About Branch" level={level} engine={engineStub()} />
        </KitProvider>,
      ));
      await settle();
      await act(async () => { window.dispatchEvent(new Event("branch-settings-help")); });
      await settle();
      const pop = document.querySelector<HTMLElement>(".kit-help-pop");
      expect(pop).toBeTruthy();
      noPortable(document.body.textContent ?? "");
      const row = host.querySelector<HTMLElement>('[data-row="Where your data lives"]');
      // Move… is Coming, so the row draws at Technical only.
      if (lv < 2) { expect(row).toBeNull(); return; }
      expect(row).toBeTruthy();
      const entry = [...pop!.querySelectorAll("div")].find((d) => d.querySelector("strong")?.textContent === "Where your data lives");
      expect(entry?.querySelector("p")?.textContent).toBe(MOVES);
    });
  }
});
