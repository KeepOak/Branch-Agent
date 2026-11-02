// @vitest-environment jsdom
// Settings › Voice & calls › Answer aloud is a working control (Never or Always), but it drew a "comes in a later update"
// line for When I talk at every level. Like every Coming line, it shows at Technical only (rows.ts COMING_FROM).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "tts.status", "tts.providers", "tts.setPersona", "tts.enable", "tts.disable",
  "tts.setProvider", "tts.speak", "voicewake.get", "voicewake.set", "talk.catalog", "agents.list", "voicecall.initiate"];
function engineOf(auto: string) {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "tts.status") return { enabled: auto !== "off", auto, personas: [] };
    if (method === "tts.providers") return { active: "", providers: [] };
    if (method === "voicewake.get") return { triggers: [] };
    if (method === "talk.catalog") return { realtime: { providers: [] }, transcription: { providers: [] } };
    if (method === "agents.list") return { agents: [] };
    return { ok: true };
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
}
async function mount(level: string, auto = "always") {
  await act(async () => root.render(<SettingsFrame engine={engineOf(auto)} page="voice" pages={R1_PAGES} />));
  await settle();
  await setLevel(level);
}
const aloud = () => host.querySelector<HTMLElement>('[data-row="voice.listening.aloud"]');
const LATER = /in a later update/i;

describe("Settings › Voice & calls › Answer aloud: the When I talk stub", () => {
  it.each(["Regular", "Advanced"])("shows no Coming line at %s", async (level) => {
    await mount(level);
    expect(host.textContent ?? "").not.toMatch(/Reading aloud only after you talk/);
    const row = aloud();
    if (row) expect(row.textContent ?? "").not.toMatch(LATER);
  });

  it("keeps the working control at Advanced", async () => {
    await mount("Advanced");
    const row = aloud();
    expect(row).toBeTruthy();
    expect([...row!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(expect.arrayContaining(["Never", "Always"]));
  });

  it("shows the Coming line at Technical, as every Coming row", async () => {
    await mount("Technical");
    expect(aloud()?.textContent ?? "").toContain("Reading aloud only after you talk comes in a later update.");
  });

  it("still says when replies are read out only on request, at Advanced", async () => {
    await mount("Advanced", "tagged");
    expect(aloud()?.textContent ?? "").toContain("Now: only when a reply asks to be read out.");
  });
});
