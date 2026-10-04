// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Markdown } from "./markdown";
import { ThreadContext } from "./context";
import type { WindowEngine } from "../connect/engine";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ""; });
async function render(text: string, engine?: WindowEngine) {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<ThreadContext.Provider value={{ name: "Ada", running: false, toast: vi.fn(), engine }}><Markdown text={text} /></ThreadContext.Provider>));
  return container;
}
it("dispatches chart fences to cards and preserves scripts as non-executable code", async () => {
  const container = await render('```chart\n{"title":"Costs","data":[{"label":"A","value":-5},{"label":"B","value":0}]}\n```\n```python\nprint(1)\n```');
  expect(container.querySelector('.artifact-preview-head')?.textContent).toContain("Costs");
  expect(container.querySelector('svg')?.getAttribute("aria-label")).toBe("Costs");
  expect(container.querySelectorAll('rect')).toHaveLength(2);
  await act(async () => container.querySelector('g')?.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
  expect(container.querySelector('[role="status"]')?.textContent).toBe("A: -5");
  expect(Array.from(container.querySelectorAll('tbody td')).map(cell => cell.textContent)).toEqual(["A", "-5", "B", "0"]);
  expect(container.querySelector('[data-testid="code-block"]')?.textContent).toContain("chart");
  expect(container.textContent).toContain("Python");
  expect(container.textContent).not.toContain("Run this script");
});
it("uses sealed frames and reports invalid chart sources alongside their code", async () => {
  const container = await render('```html\n<h1>Hi</h1>\n```\n```chart\ninvalid\n```');
  expect(container.querySelector('iframe')?.getAttribute("sandbox")).toBe("");
  expect(container.querySelector('iframe')?.srcdoc).toContain("script-src 'none'");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("JSON");
  expect(container.textContent).toContain("invalid");
});
it("shows a failed durable save without claiming the card is in Library", async () => {
  const request = vi.fn().mockRejectedValue(new Error("Workspace is unavailable"));
  const engine = { agentId: "ada", sessionKey: "agent:ada:main", scopes: ["operator.admin"], request } as unknown as WindowEngine;
  const container = await render('```svg\n<svg></svg>\n```', engine);
  const save = Array.from(container.querySelectorAll('button')).find(button => button.textContent === "Save to Library")!;
  await act(async () => save.click());
  expect(request).toHaveBeenCalledWith("agents.documents.create", expect.objectContaining({ agentId: "ada", content: "<svg></svg>" }));
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Workspace is unavailable");
  expect(container.textContent).not.toContain("In Library");
});
it("opens the larger view as a modal and closes it without a gateway action", async () => {
  const previous = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  const showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
  const container = await render('```svg\n<svg></svg>\n```');
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === "Open larger")!.click());
  expect(showModal).toHaveBeenCalledOnce();
  expect(container.querySelector('dialog iframe')?.getAttribute("sandbox")).toBe("");
  await act(async () => container.querySelector<HTMLButtonElement>('dialog button')!.click());
  expect(container.querySelector('dialog')).toBeNull();
  if (previous) Object.defineProperty(HTMLDialogElement.prototype, "showModal", previous);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});
it("renders large finite signed values without overflowing chart geometry", async () => {
  const container = await render(['bar', 'line', 'pie'].map(type => '```chart\n' + JSON.stringify({ type, title: type, data: [{ label: 'low', value: -1e308 }, { label: 'high', value: 1e308 }] }) + '\n```').join('\n'));
  const drawings = Array.from(container.querySelectorAll('.artifact-chart > svg'));
  expect(drawings).toHaveLength(3);
  for (const drawing of drawings) expect(drawing.outerHTML).not.toMatch(/NaN|Infinity/);
  expect(container.querySelector('rect')?.getAttribute('width')).toBe("170");
  expect(drawings[2].querySelector('path')?.getAttribute('d')).toContain('A120 120');
});
it("does not show a late save acknowledgement in a different engine context", async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn().mockImplementation((_method: string, params: { agentId: string; name: string; content: string }) => new Promise(resolve => {
    finish = () => resolve({ agentId: params.agentId, file: { name: params.name, path: `Documents/${params.name}`, size: 11 } });
  }));
  const engine = { agentId: "ada", sessionKey: "agent:ada:main", scopes: ["operator.admin"], request } as unknown as WindowEngine;
  const text = '```svg\n<svg></svg>\n```', container = await render(text, engine);
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === "Save to Library")!.click());
  await act(async () => root.render(<ThreadContext.Provider value={{ name: "Oak", running: false, toast: vi.fn(), engine: { ...engine, agentId: "oak" } }}><Markdown text={text} /></ThreadContext.Provider>));
  await act(async () => finish(undefined));
  expect(container.textContent).not.toContain("In Library");
  expect(container.textContent).not.toContain("Saved to Library:");
});
