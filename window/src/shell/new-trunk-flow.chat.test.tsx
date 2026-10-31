// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { NewTrunkCard } from "./NewTrunkFlow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const flow = { agentId: "fern", sessionKey: "agent:fern:main", name: "Fern", avatar: "classic" };

function engineOf(models: unknown) {
  const calls: { method: string; params: unknown }[] = [];
  const request = vi.fn(async (method: string, params?: unknown) => {
    calls.push({ method, params });
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "agents.list") return { agents: [{ id: "fern", identity: { name: "Fern" } }] };
    if (method === "models.list") return models;
    return { ok: true };
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: null, scopes: [] } as unknown as WindowEngine;
  return { engine, calls };
}

async function choose(label: string) {
  const button = [...document.querySelectorAll("button.opt")].find((node) => node.querySelector("b")?.textContent === label);
  if (!button) throw new Error(`missing option ${label}`);
  await act(async () => { (button as HTMLButtonElement).click(); });
}

describe("New Trunk chat", () => {
  it("asks the job, the care, a model and the tools, and leaves the tools on", async () => {
    const { engine, calls } = engineOf({ models: [
      { id: "gpt", provider: "openai", name: "GPT", available: true },
      { id: "off", provider: "openai", name: "Off", available: false },
    ] });
    const onDone = vi.fn();
    const onChangeLook = vi.fn();
    await act(async () => root.render(<NewTrunkCard engine={engine} flow={flow} onDone={onDone} onChangeLook={onChangeLook} />));
    expect(host.textContent).toContain("What should I take on first?");
    expect(host.textContent).toContain("Model, instructions and tools stay in details and Settings.");
    await choose("Research");
    const patch = calls.find((call) => call.method === "config.patch")?.params as { raw?: string };
    expect(patch.raw).toContain("Research");
    expect(host.textContent).toContain("How careful should I be?");
    await choose("Ask before sending, deleting or spending");
    expect(calls.find((call) => call.method === "sessions.patch")?.params).toEqual({ key: "agent:fern:main", permissionMode: "workspace" });
    expect(host.textContent).toContain("Which model should I think with?");
    expect(host.textContent).toContain("GPT");
    expect(host.textContent).not.toContain("Off");
    await choose("The usual model");
    expect(calls.some((call) => call.method === "agents.update")).toBe(false);
    expect(host.textContent).toContain("I’ll keep the usual model.");
    expect(host.textContent).toContain("Which tools should I start with?");
    expect(host.textContent).toContain("Nothing turns off. The full list stays in details and Settings.");
    await choose("The usual tools");
    expect(onDone).toHaveBeenCalledWith("Fern");
    expect(onChangeLook).not.toHaveBeenCalled();
  });

  it("sets a chosen model, and opens details when the person wants to pick tools", async () => {
    const { engine, calls } = engineOf({ models: [{ id: "gpt", provider: "openai", name: "GPT", available: true }] });
    const onDone = vi.fn();
    const onChangeLook = vi.fn();
    await act(async () => root.render(<NewTrunkCard engine={engine} flow={flow} onDone={onDone} onChangeLook={onChangeLook} />));
    await choose("Inbox & calendar");
    await choose("Ask me before everything");
    await choose("GPT");
    expect(calls.find((call) => call.method === "agents.update")?.params).toEqual({ agentId: "fern", model: "openai/gpt" });
    await choose("Choose tools in details");
    expect(onChangeLook).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledWith("Fern");
  });

  it("skips the model question when none is set up, and points at Settings", async () => {
    const { engine } = engineOf({ models: [] });
    await act(async () => root.render(<NewTrunkCard engine={engine} flow={flow} onDone={vi.fn()} />));
    await choose("Files on this computer");
    await choose("Just do it");
    expect(host.textContent).toContain("No model is set up yet. Add one in Settings.");
    expect(host.textContent).toContain("Which tools should I start with?");
    expect(host.textContent).not.toContain("Which model should I think with?");
  });
});
