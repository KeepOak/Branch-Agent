// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { hookPill, hookSwitchPatch, triggerParams, TriggersTab } from "./Triggers";
vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.now();
const hook = (name: string, on: boolean) => ({ name, description: name, source: "branch-bundled", hookKey: name, events: ["command"], enabledByConfig: on, requirementsSatisfied: true, loadable: on, managedByPlugin: false, missing: { bins: [], anyBins: [], env: [], config: [], os: [] } });
const FX: Record<string, unknown> = {
  "cron.list": { jobs: [
    { id: "t", name: "Watch invoices", enabled: true, agentId: "main", schedule: { kind: "every", everyMs: 1800000 }, trigger: { script: "x" }, payload: { kind: "agentTurn", message: "m" }, state: { triggerEvalCount: 4, lastTriggerEvalAtMs: now - 1000 } },
    { id: "s", name: "Plain schedule", enabled: true, schedule: { kind: "cron", expr: "0 8 * * *" }, payload: { kind: "agentTurn", message: "m" }, state: {} },
  ], hasMore: false },
  "cron.status": { enabled: true }, "cron.runs": { entries: [] },
  "agents.list": { defaultId: "main", agents: [{ id: "main", identity: { name: "Sapling" } }] },
  "hooks.status": { hooks: [hook("boot-md", false), hook("command-logger", true)] },
  "config.get": { hash: "h", config: {} }, "config.patch": { ok: true },
};
let root: Root | null = null, host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
async function mount(level: Level) {
  const request = vi.fn(async (method: string) => FX[method] ?? {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<TriggersTab engine={{ request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] }} level={level} openConversation={() => {}} />); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return request;
}
const byText = (t: string) => [...document.querySelectorAll("button")].find(b => b.textContent === t) as HTMLButtonElement;
async function click(el: Element) { await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }

describe("Automations › Triggers", () => {
  it("lists only automations with a check first or a process trigger, with the check readout", async () => {
    await mount("regular");
    expect(host.textContent).toContain("Watch invoices");
    expect(host.textContent).not.toContain("Plain schedule");
    expect(host.textContent).toMatch(/Checked 4 times · last .* · fired never/);
    expect(host.textContent).not.toContain("Hooks");
  });
  it("Advanced: Hooks lists hooks.status and a switch patches hooks.internal.entries", async () => {
    const request = await mount("advanced");
    expect(visibleDevNotes(host)).toEqual([]);
    for (const unbuilt of ["Set up", "Make one", "Add one", "Tell another app", "After each answer", "Gmail mail", "Feeds into a chat", "A page anyone can fill in"]) expect(host.textContent).not.toContain(unbuilt);
    await click(byText("See hooks"));
    expect(request).toHaveBeenCalledWith("hooks.status", {});
    expect(document.body.textContent).toContain("1 of 2 ready");
    expect(document.body.textContent).not.toContain("Add a hook pack");
    await click(document.querySelector("[aria-label='boot-md on or off']")!);
    expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "h", raw: JSON.stringify({ hooks: { internal: { enabled: true, entries: { "boot-md": { enabled: true } } } } }) });
  });
  it("the trigger card can only be confirmed at Technical, where the check is written", async () => {
    const request = await mount("technical");
    const input = host.querySelector("input[aria-label='Describe a new trigger']") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "summarise new PDFs"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(byText("Add"));
    const check = host.querySelector("textarea[aria-label='The check']") as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(check, "return found()"); check.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(byText("Confirm the trigger"));
    expect(request).toHaveBeenCalledWith("cron.add", expect.objectContaining({ schedule: { kind: "every", everyMs: 1800000 }, trigger: { script: "return found()" }, payload: { kind: "agentTurn", message: "summarise new PDFs" } }));
  });
  it("helpers", () => {
    expect(() => triggerParams({ task: "x", agentId: "", every: "0.1", script: "s", once: false })).toThrow("at least 30 seconds");
    expect(hookPill({ events: [] })).toBe("No events");
    expect(hookPill({ events: ["a"], requirementsSatisfied: false, missing: { bins: ["jq"] } })).toBe("Needs jq");
    expect(hookSwitchPatch("k", false)).toEqual({ hooks: { internal: { entries: { k: { enabled: false } } } } });
  });
});
