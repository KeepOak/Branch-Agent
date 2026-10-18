// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider } from "../kit";
import { APPS, CodingApps } from "./coding-apps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NETWORK_ERROR = "connect ECONNREFUSED";
const NETWORK_REASON = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";
const REPORT = { saving: () => undefined, saved: () => undefined, failed: () => undefined };
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

function engineWith(error: string) {
  let failed = true;
  const request = vi.fn(async (method: string) => {
    if (method === "branch.setup.detect") {
      if (failed) throw new Error(error);
      return { candidates: APPS.map(({ kind }) => ({ kind, credentials: true })) };
    }
    if (method === "config.get") return { hash: "test", valid: true, config: {} };
    if (method === "usage.status") return { providers: [] };
    return {};
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return { engine, request, recover: () => { failed = false; } };
}

async function show(engine: WindowEngine, level: "regular" | "advanced" | "technical" = "regular") {
  localStorage.setItem("branch.level", level);
  await act(async () => root.render(
    <KitProvider level={level === "regular" ? 0 : level === "advanced" ? 1 : 2} report={REPORT} scope={null}>
      <CodingApps engine={engine} />
    </KitProvider>,
  ));
}

function row(name: string) {
  const found = host.querySelector(`[data-row="${name}"]`);
  expect(found).not.toBeNull();
  return found!;
}
function action(name: string, label: string) {
  const buttons = [...row(name).querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.getAttribute("role") !== "switch");
  expect(buttons.map((b) => b.textContent)).toEqual([label]);
  return buttons[0];
}

describe("Coding-app rows that could not check", () => {
  it("shows a plain reason and one Check again action that reloads the failed resource", async () => {
    const { engine, request, recover } = engineWith(NETWORK_ERROR);
    await show(engine);
    for (const { name } of APPS) {
      expect(row(name).textContent).toContain("Couldn’t check");
      expect(row(name).querySelector("small")?.textContent).toBe(NETWORK_REASON);
      expect(row(name).textContent).not.toContain(NETWORK_ERROR);
      action(name, "Check again");
    }
    request.mockClear();
    recover();
    await act(async () => action("Claude Code", "Check again").click());
    expect(request.mock.calls.map(([method]) => method)).toEqual(["branch.setup.detect"]);
    for (const { name } of APPS) expect(row(name).textContent).toContain("Models ready");
  });

  it.each(["Token expired", "HTTP 401", "HTTP 403", "Unauthorized", "Unauthorised", "Forbidden"])("uses one Sign in again action for %s", async (error) => {
    const { engine, request } = engineWith(error);
    await show(engine);
    for (const { name } of APPS) action(name, "Sign in again");
    request.mockClear();
    await act(async () => action("Codex", "Sign in again").click());
    expect(request.mock.calls.map(([method]) => method)).toEqual(["branch.setup.detect"]);
    for (const { name } of APPS) action(name, "Sign in again");
  });

  it.each(["advanced", "technical"] as const)("keeps the raw reason for %s and formats it again at draw time", async (level) => {
    const { engine, request } = engineWith(NETWORK_ERROR);
    await show(engine);
    expect(row("Claude Code").querySelector("small")?.textContent).toBe(NETWORK_REASON);
    request.mockClear();
    await show(engine, level);
    expect(row("Claude Code").querySelector("small")?.textContent).toBe(NETWORK_ERROR);
    await show(engine);
    expect(row("Claude Code").querySelector("small")?.textContent).toBe(NETWORK_REASON);
    expect(request).not.toHaveBeenCalled();
  });
});
