// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlugMenu } from "./PlugMenu";
import type { WindowEngine } from "./engine";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function mount(isAdmin = true) {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { config: {} };
    if (method === "skills.status") return { skills: Array.from({ length: 74 }, (_, i) => ({ name: `Reader ${i + 1}`, skillKey: `reader-${i + 1}`, description: "Read and classify documents from the connected workspace without changing any files", eligible: true })) };
    return { groups: [] };
  });
  const engine: WindowEngine = { sessionKey: "agent:research:main", agentId: "research", request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, scopes: [] };
  const patch = vi.fn(async () => null);
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<PlugMenu anchor={createRef()} onClose={onClose} engine={engine} row={{}} trunkName="Research" isAdmin={isAdmin} patch={patch} onOpen={onOpen} />));
  return { host, patch, onOpen, onClose };
}
function button(host: HTMLElement, name: string) {
  const found = [...host.querySelectorAll("button")].find((el) => el.textContent === name);
  expect(found, name).toBeTruthy();
  return found!;
}
async function search(host: HTMLElement, query: string) {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("DA-18 tools menu", () => {
  it("keeps 74 skills out of the initial menu and uses one plain management link", async () => {
    const { host, onOpen, onClose } = await mount();
    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Tools for this conversation");
    expect(host.textContent).not.toContain("Reader 1");
    expect(host.textContent).not.toContain("74 on");
    expect(host.textContent).not.toMatch(/command-line|Add from your library/i);
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(1);
    await act(async () => button(host, "Manage tools").click());
    expect(onOpen).toHaveBeenCalledWith("customize/tools");
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("opens the skill chooser, filters it, and preserves conversation-only changes", async () => {
    const { host, patch } = await mount();
    await act(async () => button(host, "Choose skills…").click());
    await search(host, "Reader 74");
    expect(host.textContent).toContain("Reader 74");
    expect(host.textContent).not.toContain("Reader 1");
    await act(async () => button(host, "Remove").click());
    expect(patch).toHaveBeenCalledWith({ toolOverrides: { skills: { "reader-74": false } } });
    await act(async () => button(host, "Back to tools").click());
    expect(host.textContent).toContain("Choose skills…");
    expect(host.textContent).not.toContain("Reader 74");
  });
  it("finds a skill directly without expanding the whole catalog", async () => {
    const { host, patch } = await mount();
    await search(host, "Reader 74");
    expect(host.querySelectorAll('[data-testid="tool-row"]')).toHaveLength(1);
    const description = host.querySelector(".c-tool-t small");
    expect(description?.textContent?.length).toBeLessThanOrEqual(60);
    await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(patch).toHaveBeenCalledWith({ toolOverrides: { skills: { "reader-74": false } } });
    await search(host, "no such skill");
    expect(host.textContent).toContain("No tool by that name.");
  });
  it("keeps skill changes disabled for non-admin users", async () => {
    const { host, patch } = await mount(false);
    await act(async () => button(host, "Choose skills…").click());
    expect(button(host, "Remove").disabled).toBe(true);
    expect(patch).not.toHaveBeenCalled();
  });
});
