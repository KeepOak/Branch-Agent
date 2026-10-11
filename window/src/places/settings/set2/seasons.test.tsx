// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SeasonsPage } from "./seasons";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
function fixture(workshop: Record<string, unknown> = {}) {
  const saved = { skills: { workshop: { ...workshop } } };
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "config.patch") {
      const patch = JSON.parse(String(params.raw)) as typeof saved;
      Object.assign(saved.skills.workshop, patch.skills.workshop);
      return { ok: true, hash: "saved", config: structuredClone(saved) };
    }
    if (method === "config.get") return { valid: true, hash: "saved", config: structuredClone(saved) };
    return {};
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, agentId: "main", sessionKey: "agent:main:main", scopes: ["operator.admin"] };
  return { engine, request, saved };
}
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
async function show(engine: WindowEngine) {
  await act(async () => root.render(<SeasonsPage page="seasons" title="Seasons" level="regular" engine={engine} />));
  await flush();
}
function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function click(label: string) { await act(async () => button(label).click()); await flush(); }

describe("Budding settings", () => {
  it("shows the effective automatic mode and tool step when keys are unset", async () => {
    await show(fixture().engine);
    expect(button("Automatic").getAttribute("aria-pressed")).toBe("true");
    expect(button("Its own tool").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector<HTMLInputElement>('[role="switch"][aria-label="Learn what a Trunk can’t do yet"]')?.checked).toBe(true);
  });
  it("saves the real highest-step key and reads the saved selection after remount", async () => {
    const f = fixture();
    await show(f.engine);
    await click("A skill");
    expect(f.saved.skills.workshop.highestStep).toBe("skill");
    expect(f.request).toHaveBeenCalledWith("config.patch", { raw: JSON.stringify({ skills: { workshop: { highestStep: "skill" } } }), baseHash: "saved" });
    expect(button("A skill").getAttribute("aria-pressed")).toBe("true");
    await act(async () => root.unmount()); root = createRoot(host);
    await show(f.engine);
    expect(button("A skill").getAttribute("aria-pressed")).toBe("true");
    await click("Its own tool");
    expect(f.saved.skills.workshop.highestStep).toBe("tool");
  });
  it("reads all modes and keeps the switch in sync with ask-first and automatic", async () => {
    const f = fixture({ autonomous: { mode: "off" }, highestStep: "skill" });
    await show(f.engine);
    expect(button("Off").getAttribute("aria-pressed")).toBe("true");
    await click("Ask first");
    expect(f.saved.skills.workshop.autonomous).toEqual({ mode: "propose" });
    await click("Automatic");
    expect(f.saved.skills.workshop.autonomous).toEqual({ mode: "auto" });
  });
  it("disables unsupported routes and explains that code changes are PR-only", async () => {
    const f = fixture();
    await show(f.engine);
    expect(button("An add-on").disabled).toBe(true);
    expect(button("Branch’s code").disabled).toBe(true);
    expect(host.textContent).toContain("reviewed pull request");
    await click("Branch’s code");
    expect(f.request.mock.calls.some(([method]) => method === "config.patch")).toBe(false);
  });
});
