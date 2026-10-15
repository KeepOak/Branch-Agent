// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { FinishSetup, SETUP_STEPS, setupFacts } from "./Setup";
import { forgetLookStore } from "../settings/set1/appearance-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; forgetLookStore(); });

const MODELS = { models: [{ id: "m", available: true }] };
const PHONE = { paired: [{ deviceId: "d", platform: "ios", deviceFamily: "iPhone" }], pending: [] };
const EMPTY = { models: { models: [] }, devices: { paired: [] }, agents: { agents: [{ id: "main" }] }, config: { config: {} }, users: { profiles: [] }, jobs: { jobs: [] } };

function engineOf(replies: Record<string, unknown>, look: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => {
    if (method in replies) return replies[method];
    if (method === "users.prefs.get") return { status: "ok", entries: { "ui.window.look": look } };
    if (method === "users.prefs.set") return { status: "ok" };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine, request };
}

describe("Overview › Finish setting up", () => {
  it("has the preview's nine steps, in its words", () => {
    expect([...SETUP_STEPS]).toEqual(["Your models", "How much it may do", "Your first Trunk", "Reach it anywhere", "Tools", "Keep it running", "Add someone", "Bring in your history", "Make it a routine"]);
  });

  it("ticks each step from the engine's answers", () => {
    const all = setupFacts({
      models: MODELS, devices: PHONE, agents: { agents: [{ id: "main" }, { id: "scout" }] }, config: { config: { tools: { exec: { mode: "ask" } }, mcp: { servers: { gmail: {} } } } },
      users: { profiles: [{ id: "a" }, { id: "b" }] }, jobs: { jobs: [{ id: "x", name: "Morning brief" }] },
    });
    expect(Object.values(all).filter(Boolean)).toHaveLength(7);
    expect(all.keep).toBe(false);
    expect(all.history).toBe(false);
    expect(setupFacts(EMPTY)).toEqual({ models: false, howMuch: false, firstTrunk: false, reach: false, tools: false, keep: false, people: false, history: false, routine: false });
  });

  it("shows nine steps with how many are done, and Hide turns the General row off", async () => {
    const { engine } = engineOf({ "models.list": MODELS, "device.pair.list": { paired: [] }, "agents.list": { agents: [{ id: "main" }] }, "config.get": { config: {} }, "users.list": { profiles: [] }, "cron.list": { jobs: [] } });
    await act(async () => root.render(<FinishSetup engine={engine} openSettings={vi.fn()} />));
    const card = host.querySelector('[data-testid="finish-setup"]')!;
    expect(card.textContent).toContain("1 of 9 done");
    const steps = [...card.querySelectorAll<HTMLButtonElement>(".ov-step")];
    expect(steps.map((s) => [s.textContent, s.getAttribute("aria-pressed")])).toEqual([
      ["✓Your models", "true"], ["○How much it may do", "false"], ["○Your first TrunkComing", "false"], ["○Reach it anywhere", "false"], ["○Tools", "false"],
      ["○Keep it runningComing", "false"], ["○Add someone", "false"], ["○Bring in your historyComing", "false"], ["○Make it a routine", "false"],
    ]);
    expect(steps[5].disabled).toBe(true);
    expect(steps[7].disabled).toBe(true);
    await act(async () => [...card.querySelectorAll("button")].find((b) => b.textContent === "Hide")!.click());
    expect(host.querySelector('[data-testid="finish-setup"]')).toBeNull();
  });

  it("How much it may do opens Permissions, and Reach it anywhere opens the pairing dialog", async () => {
    const { engine } = engineOf({ "models.list": MODELS, "device.pair.list": { paired: [] }, "agents.list": { agents: [{ id: "main" }] }, "config.get": { config: {} }, "users.list": { profiles: [] }, "cron.list": { jobs: [] } });
    const openSettings = vi.fn();
    await act(async () => root.render(<FinishSetup engine={engine} openSettings={openSettings} />));
    const steps = [...host.querySelectorAll<HTMLButtonElement>(".ov-step")];
    await act(async () => steps[1].click());
    expect(openSettings).toHaveBeenCalledWith("permissions");
  });

  it("counts the steps the engine can answer, and keeps the two Coming steps out of the count", async () => {
    const done = engineOf({
      "models.list": MODELS, "device.pair.list": PHONE, "agents.list": { agents: [{ id: "main" }, { id: "scout" }] },
      "config.get": { config: { tools: { exec: { mode: "ask" } }, mcp: { servers: { gmail: {} } } } }, "users.list": { profiles: [{ id: "a" }, { id: "b" }] },
      "cron.list": { jobs: [{ id: "x", name: "Morning brief" }] },
    });
    await act(async () => root.render(<FinishSetup engine={done.engine} />));
    await act(async () => undefined);
    const card = host.querySelector('[data-testid="finish-setup"]')!;
    expect(card.textContent).toContain("7 of 9 done");
    expect([...card.querySelectorAll<HTMLButtonElement>(".ov-step")].filter((b) => b.disabled).map((b) => b.textContent)).toEqual(["○Keep it runningComing", "○Bring in your historyComing"]);
  });
});
