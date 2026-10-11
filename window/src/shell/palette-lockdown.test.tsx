// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Palette } from "./Palette";
import { paletteRows } from "./palette-rows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const noop = () => undefined;
let root: Root;
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});
async function mount(on = false) {
  HTMLElement.prototype.scrollIntoView = noop;
  const toggle = vi.fn();
  const close = vi.fn();
  const rows = paletteRows({ conversations: [], trunks: [], trunkName: () => "Oak", newConversation: noop,
    toggleTheme: noop, focusMode: noop, shortcuts: noop, setup: noop, tour: noop, quickAsk: noop,
    openConversation: noop, openPlace: noop, openSettings: noop, newTrunk: noop, toggleLockdown: toggle, lockdownOn: on });
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<Palette rows={rows.filter(row => row.id === "a:lockdown")} request={async <T,>() => ({}) as T} rowName={() => ""} onOpenMessage={noop} onClose={close} />));
  return { host, toggle, close };
}

describe("palette Lockdown confirmation", () => {
  it.each([false, true])("Enter requires separate confirmation when Lockdown is %s", async on => {
    const { host, toggle, close } = await mount(on);
    await act(async () => host.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(toggle).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe(`Turn Lockdown ${on ? "off" : "on"}?`);
    expect(document.activeElement?.textContent).not.toBe(`Turn Lockdown ${on ? "off" : "on"}`);
    const confirm = Array.from(host.querySelectorAll("button")).find(button => button.textContent === `Turn Lockdown ${on ? "off" : "on"}`)!;
    await act(async () => confirm.click());
    expect(toggle).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(["Cancel", "Escape", "Close", "backdrop"])("clicking the row then %s does not toggle", async dismiss => {
    const { host, toggle, close } = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    expect(toggle).not.toHaveBeenCalled();
    await act(async () => {
      if (dismiss === "Escape") host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else if (dismiss === "backdrop") host.querySelector(".scrim")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      else if (dismiss === "Close") host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
      else Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Cancel")!.click();
    });
    expect(toggle).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
});
