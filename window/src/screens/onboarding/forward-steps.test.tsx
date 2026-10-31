// @vitest-environment jsdom
// #1768: Get started must walk every first-run step, including Your models. The primary button is reused, so a
// second click of a double-click used to skip that step; only Back revealed it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { advanceFrom, freshState, STEPS } from "./model";
import { Onboarding } from "./Onboarding";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const ALL = ["branch.setup.detect", "branch.setup.verify", "branch.setup.activate", "models.authStatus", "config.get", "config.patch", "trunks.template.list", "trunks.template.create", "agents.list", "chat.send"];
type Answers = Record<string, unknown | ((params: unknown) => unknown)>;
function fakeEngine(answers: Answers, methods = ALL) {
  const request = vi.fn(async (method: string, params?: unknown) => {
    const a = answers[method];
    if (a instanceof Error) throw a;
    return typeof a === "function" ? (a as (p: unknown) => unknown)(params) : a;
  });
  const engine = { request, onEvent: () => () => {}, sessionKey: null, agentId: "main", scopes: [], features: { methods, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

/** Fresh profile: no account, no model. The issue's walk. */
const FRESH: Answers = {
  "branch.setup.detect": { candidates: [] },
  "config.get": { hash: "h1", valid: true, config: {} },
  "config.patch": { ok: true },
  "trunks.template.list": { templates: [] },
  "agents.list": { defaultId: "sapling", mainKey: "main", agents: [{ id: "sapling", identity: { name: "Sapling" } }] },
};

async function show(engine: WindowEngine) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<CapabilityProvider engine={engine}><Onboarding engine={engine} onLater={() => {}} /></CapabilityProvider>));
  await flush();
  return host;
}

function progress(host: HTMLElement) {
  const bar = host.querySelector("[role=progressbar]");
  return {
    heading: host.querySelector("h1")?.textContent,
    now: bar?.getAttribute("aria-valuenow"),
    max: bar?.getAttribute("aria-valuemax"),
    label: bar?.getAttribute("aria-label"),
    dots: [...(bar?.querySelectorAll("i") ?? [])].map((dot) => dot.className),
  };
}

describe("advanceFrom", () => {
  it("moves one step and ignores a second click that still thinks it is on the same step", () => {
    expect(advanceFrom(0, 0)).toBe(1);
    expect(advanceFrom(1, 0)).toBe(1);
    expect(advanceFrom(1, 1)).toBe(2);
    expect(advanceFrom(2, 1)).toBe(2);
    expect(freshState().step).toBe(0);
    expect(STEPS.map((s) => s.name)).toEqual(["Welcome", "Your models", "How much it may do", "Your first Trunk"]);
  });
});

describe("onboarding forward on a fresh profile", () => {
  it("walks every step from Get started, with dots that match the screen", async () => {
    const { engine } = fakeEngine(FRESH);
    const host = await show(engine);
    expect(progress(host)).toEqual({
      heading: "Hi, I’m Branch.",
      now: "1",
      max: "4",
      label: "Step 1 of 4",
      dots: ["on", "", "", ""],
    });

    await act(async () => button(host, "Get started").click());
    await flush();
    expect(progress(host)).toEqual({
      heading: "Your models",
      now: "2",
      max: "4",
      label: "Step 2 of 4",
      dots: ["done", "on", "", ""],
    });
    expect(host.textContent).toContain("No models on this computer yet.");

    await act(async () => button(host, "Continue").click());
    await flush();
    expect(progress(host)).toEqual({
      heading: "How much may it do?",
      now: "3",
      max: "4",
      label: "Step 3 of 4",
      dots: ["done", "done", "on", ""],
    });

    await act(async () => button(host, "Continue").click());
    await flush();
    expect(progress(host)).toEqual({
      heading: "Your first Trunk",
      now: "4",
      max: "4",
      label: "Step 4 of 4",
      dots: ["done", "done", "done", "on"],
    });
  });

  it("keeps Your models after a double-click on Get started, and Back from How much may it do returns to it", async () => {
    const { engine } = fakeEngine(FRESH);
    const host = await show(engine);
    const go = button(host, "Get started");
    await act(async () => go.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    await flush();
    expect(progress(host).heading).toBe("Your models");
    // The second click of a double-click lands on Continue (same control, new step) with detail 2.
    const cont = button(host, "Continue");
    await act(async () => cont.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 })));
    await flush();
    expect(progress(host)).toMatchObject({ heading: "Your models", now: "2", label: "Step 2 of 4" });

    await act(async () => button(host, "Continue").click());
    await flush();
    expect(progress(host).heading).toBe("How much may it do?");
    await act(async () => button(host, "Back").click());
    expect(progress(host)).toMatchObject({ heading: "Your models", now: "2", label: "Step 2 of 4" });
  });
});
