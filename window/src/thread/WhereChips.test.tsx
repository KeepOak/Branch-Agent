// @vitest-environment jsdom
// DA-21: the "Where it works" chips under the composer say what they set ("Working on: …", "Folder: …"), never the
// internal "own folder" idea, and each menu explains itself in one line.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../composer/engine";
import { WhereChips } from "./WhereChips";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function mount() {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "C3-PO", identity: { name: "C3-PO" } }] };
    if (method === "sessions.describe") return { session: { model: "openai/gpt-6-astra" } };
    if (method === "sessions.list") return { defaults: { model: "openai/gpt-6-astra", modelProvider: "openai" }, sessions: [] };
    if (method === "models.list") return { models: [{ id: "gpt-6-astra", provider: "openai", name: "gpt-6-astra", available: true }] };
    if (method === "projects.list") return { projects: [] };
    return {};
  });
  const engine: WindowEngine = {
    sessionKey: "agent:main:empty",
    agentId: "main",
    request: request as unknown as WindowEngine["request"],
    onEvent: () => () => undefined,
    scopes: [],
  };
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<WhereChips engine={engine} row={null} trunkName="C3-PO" advanced={false} projectName={null} onStartTopic={vi.fn()} draft />));
  await vi.waitFor(() => expect(host.querySelector('[data-testid="where-chips"]')).not.toBeNull());
  return host;
}

const chips = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="where-chips"] > button')];

describe("where chips under the composer", () => {
  it("names what each chip sets, without own folder", async () => {
    const host = await mount();
    expect(chips(host).map((b) => b.textContent)).toEqual(["Working on: This computer", "Folder: C3-PO’s files"]);
    expect(host.textContent).not.toMatch(/own folder/i);
  });

  it("explains each menu in one line", async () => {
    const host = await mount();
    const [comp, folder] = chips(host);
    await act(async () => comp.click());
    expect(document.querySelector('[data-testid="where-comp"]')?.textContent).toContain("The computer that runs its commands and code.");
    await act(async () => comp.click());
    await act(async () => folder.click());
    const menu = document.querySelector('[data-testid="where-folder"]')?.textContent ?? "";
    expect(menu).toContain("Where it reads and saves files. Until you pick one, it uses C3-PO’s files.");
    expect(menu).not.toMatch(/own folder/i);
  });
});
