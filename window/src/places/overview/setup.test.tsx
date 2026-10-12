// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { FinishSetup, setupFacts } from "./Setup";
import { forgetLookStore } from "../settings/set1/appearance-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; forgetLookStore(); });

function engineOf(replies: Record<string, unknown>, look: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => {
    if (method in replies) return replies[method];
    if (method === "users.prefs.get") return { status: "ok", entries: { "ui.window.look": look } };
    if (method === "users.prefs.set") return { status: "ok" };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine, request };
}
const MODELS = { models: [{ id: "m", available: true }] };
const PHONE = { paired: [{ deviceId: "d", platform: "ios", deviceFamily: "iPhone" }], pending: [] };
const CHAT = { channelAccounts: { telegram: [{ connected: true }] } };

describe("Overview › Finish setting up", () => {
  it("ticks each step from the engine's answers and the person's look", () => {
    expect(setupFacts(MODELS, PHONE, CHAT, { interest: "Code", accent: "#484ce5" })).toEqual({ model: true, phone: true, chat: true, interest: true, madeYours: true });
    expect(setupFacts(MODELS, PHONE, CHAT, { interest: "Code", pins: [] }, true).madeYours).toBe(true);
    expect(setupFacts(MODELS, PHONE, CHAT, { interest: "Code", pins: [], checklist: true }).madeYours).toBe(false);
    expect(setupFacts({ models: [{ available: false }] }, { paired: [{ platform: "win32" }] }, { channelAccounts: { telegram: [{ connected: false }] } }, {})).toEqual({ model: false, phone: false, chat: false, interest: false, madeYours: false });
  });

  it("shows the steps with how many are done, and Hide turns the General row off", async () => {
    const { engine, request } = engineOf({ "models.list": MODELS, "device.pair.list": { paired: [] }, "channels.status": {} });
    const openSettings = vi.fn();
    await act(async () => root.render(<FinishSetup engine={engine} openSettings={openSettings} />));
    const card = host.querySelector('[data-testid="finish-setup"]')!;
    expect(card.textContent).toContain("1 of 5 done");
    const steps = [...card.querySelectorAll<HTMLButtonElement>(".ov-step")];
    expect(steps.map((s) => [s.textContent, s.getAttribute("aria-pressed")])).toEqual([["✓A model account", "true"], ["○Your phone", "false"], ["○A chat app", "false"], ["○What you want help with", "false"], ["○Make it yours", "false"]]);
    await act(async () => steps[4].click());
    expect(openSettings).toHaveBeenCalledWith("appearance");
    await act(async () => steps[3].click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".ov-pick")].find((b) => b.textContent?.startsWith("Research"))!.click());
    const sets = request.mock.calls.filter(([m]) => m === "users.prefs.set") as unknown as [string, { entries: Record<string, Record<string, unknown>> }][];
    expect(sets[sets.length - 1][1].entries["ui.window.look"]).toMatchObject({ interest: "Research" });
    await act(async () => [...card.querySelectorAll("button")].find((b) => b.textContent === "Hide")!.click());
    expect(host.querySelector('[data-testid="finish-setup"]')).toBeNull();
  });

  it("stays away once every step is done or the person hid it", async () => {
    const done = engineOf({ "models.list": MODELS, "device.pair.list": PHONE, "channels.status": CHAT }, { interest: "Code", theme: "user/mine" });
    await act(async () => root.render(<FinishSetup engine={done.engine} />));
    await act(async () => undefined);
    expect(host.querySelector('[data-testid="finish-setup"]')).toBeNull();
  });
});
