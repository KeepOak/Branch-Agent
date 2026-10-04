// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });
async function render(text: string, lang = "json") {
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root?.render(<CodeBlock text={text} lang={lang} />));
  return host;
}
it("shows duplicate keys and exact numeric text in the default Tree", async () => {
  const host = await render('{"2":1.00,"1":1E+03,"a":9007199254740993,"a":1e400}');
  expect(Array.from(host.querySelectorAll('.json-code-key'), node => node.textContent)).toEqual(['"2": ', '"1": ', '"a": ', '"a": ']);
  expect(Array.from(host.querySelectorAll('[data-json-literal]'), node => node.textContent)).toEqual(['1.00', '1E+03', '9007199254740993', '1e400']);
  expect(host.querySelector('summary')?.textContent).toBe("Object (4 keys)");
  expect(host.querySelector('[aria-label="Wrap lines"]')?.hasAttribute("hidden")).toBe(true);
});
it("preserves nested fold state and original whitespace when switching Tree/Raw", async () => {
  const text = '\t{\n\t"nested": {"a": [1, 2]}\n}', host = await render(text);
  const fold = host.querySelectorAll<HTMLDetailsElement>('details')[1]; fold.open = false;
  const raw = Array.from(host.querySelectorAll('button')).find(button => button.textContent === "Raw")!;
  const tree = Array.from(host.querySelectorAll('button')).find(button => button.textContent === "Tree")!;
  await act(async () => raw.click());
  expect(host.querySelector('pre')?.hidden).toBe(false);
  expect(host.querySelector('pre code')?.textContent).toBe(text);
  expect(raw.getAttribute("aria-pressed")).toBe("true");
  await act(async () => tree.click());
  expect(host.querySelectorAll('details')[1]).toBe(fold); expect(fold.open).toBe(false);
  expect(host.querySelector('pre')?.hidden).toBe(true);
});
it("keeps literal escapes and HTML inert in the Tree", async () => {
  const host = await render('{"\\u0061":"</code><img src=x onerror=alert(1)>","text":"**literal**"}');
  expect(host.querySelector('.json-code-key')?.textContent).toBe('"\\u0061": ');
  expect(host.querySelector('img, script, strong')).toBeNull();
  expect(host.querySelector('.json-code-tree')?.textContent).toContain("<img src=x");
});
it.each(['{"invalid":}', ' '.repeat(20000) + '{}'])("leaves unavailable trees in Raw with complete copy source", async text => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const host = await render(text);
  expect(host.querySelector('.json-code-tree')).toBeNull();
  expect(Array.from(host.querySelectorAll('button')).find(button => button.textContent === "Tree")?.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Copy"]')!.click());
  expect(writeText).toHaveBeenCalledWith(text);
});
it("keeps ordinary code wrap and line folding controls", async () => {
  const host = await render(Array.from({ length: 9 }, (_, i) => `line${i}`).join('\n'), "python");
  expect(host.querySelector('.json-code-modes')).toBeNull();
  expect(host.querySelector('pre')?.textContent).not.toContain("line8");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Wrap lines"]')!.click());
  expect(host.querySelector('pre')?.className).toBe("wrap");
  await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === "Show 2 more lines")!.click());
  expect(host.querySelector('pre')?.textContent).toContain("line8");
});
