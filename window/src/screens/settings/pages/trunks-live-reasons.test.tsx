// @vitest-environment jsdom
// Settings › Trunks, "Defaults for every Trunk" (Private #1093 frame B-063): "See them", "Add one" and "Browse" were greyed with
// no reason. Each waits for an engine feature (standing orders, a specialist's standing instruction, an agent marketplace),
// so it stays below the Coming gate at Regular and Advanced, and at Technical says why in one visible line that the
// button names with aria-describedby, like the switches beside it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";
import { TRUNK_DEFAULTS } from "./trunks-live";

vi.mock("../../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
vi.mock("../../../face/CharacterFace", () => ({ CharacterFace: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const ROSTER = { defaultId: "oak", mainKey: "main", agents: [{ id: "oak", identity: { name: "Oak", theme: "Helps" } }] };
const CONFIG = { hash: "h1", valid: true, config: { agents: { defaults: { userTimezone: "UTC" }, entries: { oak: { default: true } } } } };
async function mount(level: "regular" | "advanced" | "technical") {
  localStorage.setItem("branch.level", level);
  const request = vi.fn(async (method: string) => method === "agents.list" ? ROSTER : method === "config.get" ? CONFIG : {});
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "oak", scopes: ["operator.admin"], features: { methods: ["agents.list", "config.get", "config.patch"], events: [] } } as unknown as WindowEngine;
  await act(async () => root.render(<SettingsFrame engine={engine} page="trunks" pages={R1_PAGES} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  return request;
}
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);
const B063 = [["See them", "Standing orders"], ["Add one", "“From now on” for a specialist"], ["Browse", "Agent marketplace"]] as const;

it("keeps See them, Add one and Browse (Coming) out of Regular and Advanced, with no later-update line", async () => {
  for (const level of ["regular", "advanced"] as const) {
    await mount(level);
    for (const [text] of B063) expect(button(text), `${text} at ${level}`).toBeUndefined();
    expect(host.textContent).not.toContain("later update");
    await act(async () => root.unmount()); root = createRoot(host);
  }
});

it("at Technical, See them, Add one and Browse each say why in one visible line named by aria-describedby", async () => {
  const request = await mount("technical");
  for (const [text, label] of B063) {
    expect(TRUNK_DEFAULTS.find((d) => d.button === text)?.label).toBe(label);
    const b = button(text)!;
    expect(b, text).toBeTruthy();
    expect(b.getAttribute("aria-disabled")).toBe("true");
    const why = document.getElementById(b.getAttribute("aria-describedby") ?? "");
    expect(why?.textContent, text).toBe(`${label} comes in a later update.`);
    expect(b.closest(".r1s-row")!.contains(why)).toBe(true);
    const calls = request.mock.calls.length;
    await act(async () => b.click());
    expect(request.mock.calls.length).toBe(calls);
  }
  // Every greyed control in the card, switch or button, has its line.
  const card = host.querySelector<HTMLElement>('.r1s-sec[aria-label="Defaults for every Trunk"]')!;
  for (const row of card.querySelectorAll<HTMLElement>(".r1s-row")) {
    const ctl = row.querySelector<HTMLElement>(".r1s-ctl button")!;
    expect(row.querySelector(".r1s-note")?.id).toBe(ctl.getAttribute("aria-describedby"));
  }
});
