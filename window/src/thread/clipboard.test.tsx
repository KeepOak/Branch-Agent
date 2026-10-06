// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ErrorBlock } from "./blocks";
import { ThreadContext } from "./context";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

it("copies a failed run's full error through the desktop bridge when browser clipboard is blocked", async () => {
  const error = "Command failed: pnpm build\nExit code 1\nA2A declaration error";
  const browserWrite = vi.fn().mockRejectedValue(new DOMException("Write permission denied", "NotAllowedError"));
  const desktopWrite = vi.fn().mockResolvedValue(undefined);
  const toast = vi.fn();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: browserWrite } });
  (window as unknown as { branchDesktop?: unknown }).branchDesktop = { clipboard: { writeText: desktopWrite } };
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(
    <ThreadContext.Provider value={{ name: "Builder", toast, running: false }}>
      <ErrorBlock block={{ kind: "error", key: "failed-run", message: error }} onDismiss={() => {}} />
    </ThreadContext.Provider>,
  ));
  await act(async () => { host.querySelector<HTMLButtonElement>("[data-testid=run-error] .row-buttons button")!.click(); });
  await vi.waitFor(() => expect(desktopWrite).toHaveBeenCalledWith(error));
  expect(browserWrite).toHaveBeenCalledWith(error);
  expect(toast).toHaveBeenCalledWith("Copied.");
});

it("reports a blocked browser clipboard when no desktop bridge exists", async () => {
  const browserWrite = vi.fn().mockRejectedValue(new Error("Write permission denied"));
  const toast = vi.fn();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: browserWrite } });
  const { copyText } = await import("./context");
  await copyText("error", toast);
  expect(toast).toHaveBeenCalledWith("Couldn't copy: Write permission denied");
});
