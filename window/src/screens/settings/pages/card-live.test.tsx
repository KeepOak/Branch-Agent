// @vitest-environment jsdom
// Settings › Your card is a native R1 page (#1049, section D blocker 1): it never hands the window to Classic Settings ›
// People, and it draws the approved preview's one "Your card" card with its three rows (preview.html PG card: your name
// with View and Edit, Your picture with Choose…, See your card with Open). The nav row shows your initial and name over
// "Your card", as the preview's s36Me.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { forgetLookStore } from "../../../places/settings/set1/appearance-store";
import { CLASSIC_PAGE, r1SettingsPage } from "../../frame/R1Window";
import { PAGES } from "../nav";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "users.self") return { profile: { id: "gateway-owner", displayName: "Taofik" } };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"] } as unknown as WindowEngine, request };
}
async function mount(engine: WindowEngine) {
  await act(async () => root.render(<SettingsFrame engine={engine} page="card" pages={R1_PAGES} />));
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

it("is an R1 Settings page, never Classic People", () => {
  expect(r1SettingsPage("card", R1_PAGES)).toBe(true);
  expect(CLASSIC_PAGE.card).toBeUndefined();
  expect(PAGES.card.cards).toEqual(["Your card"]);
});

it("draws the preview's one card with its three rows, at every level", async () => {
  const { engine } = engineOf();
  for (const level of ["regular", "advanced", "technical"]) {
    localStorage.setItem("branch.level", level);
    await mount(engine);
    expect([...host.querySelectorAll(".r1s-sec > h2")].map((h) => h.textContent)).toEqual(["Your card"]);
    expect([...host.querySelectorAll<HTMLElement>(".r1s-sec [data-row]")].map((r) => r.dataset.row)).toEqual(["card.card.name", "card.card.picture", "card.card.see"]);
    const name = host.querySelector<HTMLElement>('[data-row="card.card.name"]')!;
    expect(name.textContent).toContain("Taofik");
    expect([...name.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["View", "Edit"]);
    expect(host.querySelector('[data-row="card.card.picture"]')!.textContent).toContain("Choose…");
    expect(host.querySelector('[data-row="card.card.see"] button')!.textContent).toBe("Open");
    await act(async () => root.unmount()); root = createRoot(host); forgetLookStore();
  }
});

it("saves your name with users.setDisplayName, as Classic People does", async () => {
  const { engine, request } = engineOf();
  await mount(engine);
  const name = host.querySelector<HTMLElement>('[data-row="card.card.name"]')!;
  await act(async () => { [...name.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Edit")!.click(); });
  const input = name.querySelector<HTMLInputElement>("input[aria-label='Your name']")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Taofik B"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { [...name.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Save")!.click(); await new Promise((r) => setTimeout(r, 0)); });
  expect(request).toHaveBeenCalledWith("users.setDisplayName", { profileId: "gateway-owner", displayName: "Taofik B" });
});

it("shows your initial and name over Your card in the nav at Advanced and Technical, as the preview's s36Me", async () => {
  const { engine } = engineOf();
  for (const level of ["advanced", "technical"]) {
    localStorage.setItem("branch.level", level);
    await mount(engine);
    const me = host.querySelector<HTMLElement>(".r1s-nav[data-page=card]")!;
    expect(me.querySelector(".r1s-me-av")?.textContent).toBe("T");
    expect(me.querySelector("b")?.textContent).toBe("Taofik");
    expect(me.querySelector("small")?.textContent).toBe("Your card");
    await act(async () => root.unmount()); root = createRoot(host); forgetLookStore();
  }
});

it("at Regular, Your card sits in the General page: General is the current nav row and Your card is under its Advanced", async () => {
  localStorage.setItem("branch.level", "regular");
  await mount(engineOf().engine);
  expect(host.querySelector<HTMLElement>(".r1s-nav[aria-current=page]")?.dataset.hub).toBe("General");
  expect(host.querySelector(".r1s-advanced [data-page=card]")?.getAttribute("aria-current")).toBe("true");
});
