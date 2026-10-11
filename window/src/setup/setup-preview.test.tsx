// @vitest-environment jsdom
// Preview rail: order, names, ticks only after a step is passed, and Run setup again restarts at Welcome.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import type { SaplingSession } from "../connect/session";
import { railTicked, rerunSetup, RUN_SETUP_AGAIN, STEPS } from "./setup-model";
import { SetupFlow } from "./SetupFlow";
import { useFirstRun } from "./use-first-run";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  sessionStorage.clear();
});

async function show(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(node));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

function engine(answers: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => answers[method] ?? {});
  return { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "k", scopes: ["operator.admin"], agentId: "main" } as WindowEngine;
}

const SET_UP = {
  "config.get": { hash: "h", config: { wizard: { lastRunAt: "x", securityAcknowledgedAt: "x" }, agents: { defaults: { model: "openai/gpt" } } } },
};

const rail = (host: HTMLElement) => [...host.querySelectorAll(".ob-rail li")].map((li) => ({ name: li.textContent?.replace(/^\d+/, "").trim(), cls: li.className }));

describe("setup preview rail", () => {
  it("uses the preview’s step order and exact names", () => {
    expect([...STEPS]).toEqual([
      "Welcome",
      "Where Branch runs",
      "Models",
      "Make it yours",
      "Your first Trunks",
      "Reach it anywhere",
      "Tools",
      "Keep it running",
      "People",
      "Two more things",
      "Health check",
    ]);
    expect(railTicked(0, 4)).toBe(false);
    expect(railTicked(5, 4)).toBe(true);
    expect(railTicked(4, 4)).toBe(false);
  });

  it("does not tick Your first Trunks on Welcome, even when Trunks already exist", async () => {
    const host = await show(<SetupFlow engine={engine(SET_UP)} version="1" trunkNames={["Researcher", "Expense Manager"]} defaultAgentId="main" defaultName="Sapling" startAt={0} onClose={() => {}} onLocalModel={() => {}} />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(host.querySelector("h2")?.textContent).toBe("Hi, I’m Branch.");
    expect(host.textContent).toContain("It asks before it sends, deletes, spends or installs anything.");
    expect(host.textContent).not.toContain("You choose how much Branch asks before it acts.");
    const names = rail(host);
    expect(names.map((r) => r.name)).toEqual([...STEPS]);
    expect(names.find((r) => r.name === "Your first Trunks")?.cls).toBe("");
    expect(names.find((r) => r.name === "Welcome")?.cls).toBe("now");
    expect(names.every((r) => r.name === "Welcome" || r.cls !== "done")).toBe(true);
  });

  it("ticks a step only after the person has passed it", async () => {
    const host = await show(<SetupFlow engine={engine({})} version="1" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" onClose={() => {}} onLocalModel={() => {}} />);
    await act(async () => (host.querySelector('[data-testid="setup-promise"]') as HTMLInputElement).click());
    await act(async () => (host.querySelector('[data-testid="setup-next"]') as HTMLButtonElement).click());
    const names = rail(host);
    expect(host.querySelector("h2")?.textContent).toBe("Where should Branch run?");
    expect(names.find((r) => r.name === "Welcome")?.cls).toBe("done");
    expect(names.find((r) => r.name === "Where Branch runs")?.cls).toBe("now");
    expect(names.find((r) => r.name === "Your first Trunks")?.cls).toBe("");
  });

  it("Run setup again reopens at Welcome with a clear rail", async () => {
    const host = await show(<SetupFlow engine={engine(SET_UP)} version="1" trunkNames={["Researcher"]} defaultAgentId="main" defaultName="Sapling" startAt={5} onClose={() => {}} onLocalModel={() => {}} />);
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(host.querySelector("h2")?.textContent).toBe("Reach Branch anywhere");
    expect(rail(host).find((r) => r.name === "Your first Trunks")?.cls).toBe("done");
    await act(async () => rerunSetup());
    expect(host.querySelector("h2")?.textContent).toBe("Hi, I’m Branch.");
    const names = rail(host);
    expect(names.find((r) => r.name === "Welcome")?.cls).toBe("now");
    expect(names.find((r) => r.name === "Your first Trunks")?.cls).toBe("");
    expect(names.find((r) => r.name === "Reach it anywhere")?.cls).toBe("");
  });

  it("Run setup again opens a closed setup at Welcome", async () => {
    const session = { request: vi.fn(async () => ({ config: { wizard: { lastRunAt: "x" } } })) } as unknown as SaplingSession;
    function Probe() {
      const first = useFirstRun(session, true, () => false, 1);
      return <span data-testid="step">{first.step ?? "closed"}</span>;
    }
    const host = await show(<Probe />);
    await act(async () => new Promise((r) => setTimeout(r, 750)));
    expect(host.querySelector('[data-testid="step"]')?.textContent).toBe("closed");
    await act(async () => rerunSetup());
    expect(host.querySelector('[data-testid="step"]')?.textContent).toBe("0");
    expect(RUN_SETUP_AGAIN).toBe("branch:run-setup-again");
  });
});
