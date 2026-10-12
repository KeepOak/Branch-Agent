// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StreamedMarkdown } from "./streaming";
import { Markdown } from "./markdown";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("paces a burst across frames and cancels pending reveal when complete", async () => {
  const text = "A long streamed reply with several words arrives in one network chunk.";
  await act(async () => root.render(<StreamedMarkdown text={text} streaming />));
  await act(async () => vi.advanceTimersByTime(17));
  expect(host.textContent!.length).toBeGreaterThan(0);
  expect(host.textContent!.length).toBeLessThan(text.length);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(host.textContent).toBe(text);
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => root.render(<StreamedMarkdown text={`${text} Finished.`} streaming={false} />));
  expect(host.textContent).toContain("Finished.");
});
it("keeps completed paragraphs, lists and code DOM when fences close", async () => {
  const prefix = "A completed paragraph.\n\n- First item\n- Second item\n\n```js\nconst x = 1;";
  await act(async () => root.render(<Markdown text={prefix} />));
  const paragraph = host.querySelector('p'); const list = host.querySelector('ul'); const code = host.querySelector('.code-block');
  await act(async () => root.render(<Markdown text={`${prefix}\n\`\`\`\n\nAnother paragraph.`} />));
  expect(host.querySelector('p')).toBe(paragraph);
  expect(host.querySelector('ul')).toBe(list);
  expect(host.querySelector('.code-block')).toBe(code);
});
it("shows reduced-motion replies immediately", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  await act(async () => root.render(<StreamedMarkdown text="Full reply" streaming />));
  expect(host.textContent).toBe("Full reply");
});

it("continues revealing under StrictMode and clears a replaced empty stream", async () => {
  await act(async () => root.render(<StrictMode><StreamedMarkdown text="A reply" streaming /></StrictMode>));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(host.textContent).toBe("A reply");
  await act(async () => root.render(<StrictMode><StreamedMarkdown text="" streaming /></StrictMode>));
  await act(async () => vi.advanceTimersByTime(17));
  expect(host.textContent).toBe("");
});
