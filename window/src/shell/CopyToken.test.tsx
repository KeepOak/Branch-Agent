// @vitest-environment jsdom
// Private #1103 item 2: a long code or path ends in an ellipsis, keeps its whole value in the title, and Copy puts the
// whole value on the clipboard with visible feedback (the button reads "Copied", the toast says "Copied.").
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { COPIED_MS, CopyToken } from "./CopyToken";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const LONG = "eyJ1cmwiOiJ3c3M6Ly9icmFuY2g" + "x".repeat(400);
let root: Root, host: HTMLDivElement;
const writeText = vi.fn(async (_text: string) => undefined);
beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  writeText.mockClear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { vi.useRealTimers(); await act(async () => root.unmount()); host.remove(); });

it("shows the whole value on one truncating line, with the full value in its title", async () => {
  await act(async () => root.render(<CopyToken value={LONG} label="Copy code" toast={() => undefined} />));
  const text = host.querySelector<HTMLElement>(".copy-token-text")!;
  expect(text.textContent).toBe(LONG);
  expect(text.title).toBe(LONG);
  expect(host.querySelector("button")!.textContent).toBe("Copy code");
});

it("Copy writes the whole value and says Copied, on the button and in a toast, then the button reads Copy again", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const toast = vi.fn();
  await act(async () => root.render(<CopyToken value={LONG} label="Copy code" toast={toast} />));
  await act(async () => { host.querySelector("button")!.click(); });
  await act(async () => { await Promise.resolve(); });
  expect(writeText).toHaveBeenCalledWith(LONG);
  expect(toast).toHaveBeenCalledWith("Copied.");
  expect(host.querySelector("button")!.textContent).toBe("Copied");
  await act(async () => { vi.advanceTimersByTime(COPIED_MS + 10); });
  expect(host.querySelector("button")!.textContent).toBe("Copy code");
});

it("a refused clipboard says so and never claims Copied", async () => {
  writeText.mockRejectedValueOnce(new Error("Not allowed"));
  const toast = vi.fn();
  await act(async () => root.render(<CopyToken value="abc" toast={toast} />));
  await act(async () => { host.querySelector("button")!.click(); });
  await act(async () => { await Promise.resolve(); });
  expect(toast).toHaveBeenCalledWith("Couldn't copy: Not allowed");
  expect(host.querySelector("button")!.textContent).toBe("Copy");
});
