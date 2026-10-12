// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Seg } from "./kit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
async function render(children: ReactNode) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(children));
}
async function key(button: HTMLButtonElement, name: string, init: KeyboardEventInit = {}) {
  await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, ...init })));
}
const choices = [{ id: "off", label: "Off" }, { id: "needed", label: "When needed", off: "Unavailable" }, { id: "on", label: "On" }];

describe("segmented settings keyboard", () => {
  it("selects and focuses enabled choices, wraps, and supports Home and End", async () => {
    const change = vi.fn();
    function Choice() {
      const [value, setValue] = useState("off");
      return <Seg label="Motion" value={value} options={choices} onChange={(id) => { setValue(id); change(id); }} />;
    }
    await render(<Choice />);
    const [off, unavailable, on] = [...document.querySelectorAll<HTMLButtonElement>("button")];
    off.focus();
    await key(off, "ArrowRight");
    expect(document.activeElement).toBe(on);
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(on.tabIndex).toBe(0);
    expect(unavailable.disabled).toBe(true);
    await key(on, "ArrowDown");
    expect(document.activeElement).toBe(off);
    await key(off, "End");
    expect(document.activeElement).toBe(on);
    await key(on, "Home");
    expect(document.activeElement).toBe(off);
    expect(change.mock.calls.map(([id]) => id)).toEqual(["on", "off", "on", "off"]);
  });

  it("keeps unavailable stored values keyboard reachable through the first enabled choice", async () => {
    await render(<Seg label="Motion" value="needed" options={choices} onChange={vi.fn()} />);
    expect(document.querySelectorAll<HTMLButtonElement>("button")[0].tabIndex).toBe(0);
    expect(document.querySelectorAll<HTMLButtonElement>("button")[1].tabIndex).toBe(-1);
  });

  it("ignores modified arrows and wholly disabled groups", async () => {
    const change = vi.fn();
    await render(<Seg label="Motion" value="off" options={choices} onChange={change} />);
    const off = document.querySelector<HTMLButtonElement>("button")!;
    await key(off, "ArrowRight", { ctrlKey: true });
    expect(change).not.toHaveBeenCalled();
    await act(async () => root?.render(<Seg label="Motion" value="off" options={choices} disabled onChange={change} />));
    await key(off, "ArrowRight");
    expect(change).not.toHaveBeenCalled();
  });
});
