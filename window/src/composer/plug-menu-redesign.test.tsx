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
    if (method === "skills.status") return { skills: [
      ...Array.from({ length: 74 }, (_, i) => ({ name: `Reader ${i + 1}`, skillKey: `reader-${i + 1}`, description: "Read and classify documents from the connected workspace without changing any files", eligible: true })),
      { name: "Mailer", skillKey: "mailer", description: "Send mail from the shared inbox", eligible: false, missing: { env: ["MAIL_TOKEN"] } },
      { name: "Scanner", skillKey: "scanner", description: "Scan paper documents", eligible: false, missing: { bins: ["scanimage"] } },
    ] };
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
function chooser(host: HTMLElement) {
  const found = host.querySelector<HTMLButtonElement>(".c-libadd");
  expect(found?.querySelector("b")?.textContent).toBe("Choose skills…");
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
    expect(host.querySelectorAll(".c-plug-sec")).toHaveLength(0);
    expect(chooser(host).querySelector("small")?.textContent).toBe("74 on");
    expect(chooser(host).querySelector(".c-pill.warn")?.textContent).toBe("2 need setup");
    expect(host.textContent).not.toMatch(/command-line|Add from your library/i);
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(1);
    await act(async () => button(host, "Manage tools").click());
    expect(onOpen).toHaveBeenCalledWith("customize/tools");
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("opens the skill chooser, filters it, and preserves conversation-only changes", async () => {
    const { host, patch } = await mount();
    await act(async () => chooser(host).click());
    await search(host, "Reader 74");
    expect(host.textContent).toContain("Reader 74");
    expect(host.textContent).not.toContain("Reader 1");
    await act(async () => button(host, "Remove").click());
    expect(patch).toHaveBeenCalledWith({ toolOverrides: { skills: { "reader-74": false } } });
    await act(async () => button(host, "Back to tools").click());
    expect(host.textContent).toContain("Choose skills…");
    expect(host.textContent).not.toContain("Reader 74");
  });
  it("keeps skills that need setup visible with their warning", async () => {
    const { host } = await mount();
    await act(async () => chooser(host).click());
    const heads = [...host.querySelectorAll(".c-ph")].map((x) => x.textContent);
    expect(heads).toEqual(["Chosen here", "Add from your libraries", "Needs setup"]);
    const rows = [...host.querySelectorAll(".c-librow")].filter((r) => r.querySelector(".c-pill"));
    expect(rows.map((r) => [r.querySelector("b")?.textContent, r.querySelector(".c-pill")?.textContent])).toEqual([["Mailer", "Needs a key"], ["Scanner", "Not running"]]);
    expect(rows.every((r) => !r.querySelector("button"))).toBe(true);
    await act(async () => button(host, "Back to tools").click());
    await search(host, "Mailer");
    expect(host.querySelector('[data-testid="tool-row"] .c-pill.warn')?.textContent).toBe("Needs a key");
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
    await act(async () => chooser(host).click());
    expect(button(host, "Remove").disabled).toBe(true);
    expect(patch).not.toHaveBeenCalled();
  });
});
