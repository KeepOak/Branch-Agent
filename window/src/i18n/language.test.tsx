// @vitest-environment jsdom
// Settings › Appearance › Language (Private #1100): a language picker on both Appearance pages, kept in the person's
// look, and the Settings words that already have a translation (from the Control UI's translations) follow it, with
// English for every other word.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { forgetLookStore } from "../places/settings/set1/appearance-store";
import { SettingsFrame } from "../screens/settings/SettingsFrame";
import { CATALOG } from "./catalog";
import { LANGUAGES, language, setLanguage, t } from "./language";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); forgetLookStore(); setLanguage("en"); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; setLanguage("en"); });

function engineOf(look: Record<string, unknown> = {}) {
  const prefs: Record<string, unknown> = { "ui.window.look": look };
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: { ...prefs } };
    if (method === "users.prefs.set") { Object.assign(prefs, params.entries); return { status: "ok" }; }
    if (method === "themes.list") return { current: {} };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"] } as unknown as WindowEngine, request, prefs };
}
async function mount(engine: WindowEngine, page?: string) {
  await act(async () => root.render(<SettingsFrame engine={engine} page={page} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const nav = () => [...host.querySelectorAll<HTMLElement>(".r1s-list .r1s-nav")].map((b) => b.textContent);

describe("Settings › Appearance › Language", () => {
  it("translates the words that have a translation and keeps English for the rest", () => {
    setLanguage("de");
    expect(language()).toBe("de");
    expect(document.documentElement.lang).toBe("de");
    expect(t("General")).toBe("Allgemein");
    expect(t("Usage")).toBe("Nutzung");
    expect(t("Show agents’ work")).toBe("Show agents’ work");
    expect(t("Branch")).toBe("Branch");
    setLanguage("xx");
    expect(language()).toBe("en");
    expect(t("General")).toBe("General");
  });

  it("offers every language the catalog has, in its own name, English first", () => {
    expect(LANGUAGES[0]).toEqual({ id: "en", name: "English" });
    expect(LANGUAGES.slice(1).map((l) => l.id).sort()).toEqual(Object.keys(CATALOG).sort());
    expect(LANGUAGES.length).toBe(21);
    for (const words of Object.values(CATALOG)) expect(Object.keys(words)).toContain("Appearance");
  });

  it("the Settings titles follow the person's language", async () => {
    await mount(engineOf({ lang: "de" }).engine);
    expect(nav()).toEqual(["Allgemein", t("Computer"), "Nutzung", t("Updates")]);
    expect(host.querySelector("h1")?.textContent).toBe("Allgemein");
    expect([...host.querySelectorAll(".r1s-sec h2")].map((h) => h.textContent)).toContain("Show agents’ work");
  });

  it("picking a language on the Appearance page saves it to the look and switches the words at once", async () => {
    const { engine, prefs } = engineOf();
    await mount(engine, "appearance");
    expect(host.querySelector("h1")?.textContent).toBe("Appearance");
    const pick = host.querySelector<HTMLSelectElement>('select[aria-label="Language"]')!;
    expect(pick.tagName).toBe("SELECT");
    expect(pick.options.length).toBe(21);
    await act(async () => { pick.value = "fr"; pick.dispatchEvent(new Event("change", { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
    expect((prefs["ui.window.look"] as { lang?: string }).lang).toBe("fr");
    expect(language()).toBe("fr");
    expect(host.querySelector("h1")?.textContent).toBe(CATALOG.fr.Appearance);
    expect(CATALOG.fr.Appearance).toBe("Apparence");
  });
});
