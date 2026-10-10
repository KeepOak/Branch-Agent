// @vitest-environment jsdom
// Every place and every Settings page, at Technical with every tab opened: no developer note (shell/shown-why.ts)
// shows as text, a tooltip or a label, while the controls waiting on the engine stay greyed.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { visibleDevNotes } from "../shell/shown-why.testing";
import type { PlaceProps } from "../places-nav/PlaceFrame";
import { AutomationsPlace } from "./automations";
import { CustomizePlace } from "./customize";
import { InboxPlace } from "./inbox";
import { LibraryPlace } from "./library";
import { OverviewPlace } from "./overview";
import { PeoplePlace } from "./people";
import { SettingsPage } from "./settings";

const reply = (method: string) => (method === "agents.list" ? { defaultId: "main", agents: [{ id: "main", name: "Sapling" }] } : {});
const engine = (): WindowEngine => ({ request: vi.fn(async (method: string) => reply(method)) as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "test", scopes: ["operator.admin", "operator.write"] });
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined })) as unknown as typeof window.matchMedia; localStorage.setItem("branch.level", "technical"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); });

const settle = async () => { for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>("[role=tab]")];
const click = async (el: HTMLElement) => { await act(async () => el.click()); await settle(); };

/** Renders, then opens every tab and every tab inside it, collecting what shows. */
async function sweep(node: ReactNode): Promise<{ notes: string[]; greyed: number }> {
  await act(async () => root.render(node));
  await settle();
  const notes = new Set(visibleDevNotes(host));
  let greyed = host.querySelectorAll(":disabled, [aria-disabled=true]").length;
  for (let i = 0; i < tabs().length; i += 1) {
    const top = tabs()[i];
    const list = top.closest("[role=tablist]") ?? top.parentElement;
    await click(top);
    visibleDevNotes(host).forEach((n) => notes.add(n));
    greyed += host.querySelectorAll(":disabled, [aria-disabled=true]").length;
    for (let j = 0; j < tabs().length; j += 1) {
      const inner = tabs()[j];
      if ((inner.closest("[role=tablist]") ?? inner.parentElement) === list) continue;
      await click(inner);
      visibleDevNotes(host).forEach((n) => notes.add(n));
    }
  }
  return { notes: [...notes], greyed };
}

const props = (): PlaceProps => ({ engine: engine(), facts: { running: 0, waiting: 0 }, openConversation: () => undefined, openPlace: () => undefined, openSettings: () => undefined, startConversation: () => undefined, level: "technical" });
const PLACES = { overview: OverviewPlace, inbox: InboxPlace, automations: AutomationsPlace, library: LibraryPlace, people: PeoplePlace, customize: CustomizePlace };
const PAGES = ["general", "people", "appearance", "notifications", "instructions", "models", "local", "accounts", "voice", "chatapps", "permissions", "computer", "secrets", "usage", "backups", "gateway", "self", "seasons", "updates", "achievements", "advanced", "developer"];

describe("developer notes stay out of sight", () => {
  for (const [id, Place] of Object.entries(PLACES)) {
    it(`${id}: no note shows, and its unfinished controls stay greyed`, async () => {
      const { notes, greyed } = await sweep(<Place {...props()} />);
      expect(notes).toEqual([]);
      expect(greyed).toBeGreaterThan(0);
    });
  }
  for (const page of PAGES) {
    it(`Settings › ${page}: no note shows`, async () => {
      const { notes } = await sweep(<SettingsPage page={page} title={page} level="technical" engine={engine()} />);
      expect(notes).toEqual([]);
    });
  }
});
