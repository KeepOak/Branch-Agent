// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LockdownBanner } from "./LockdownBanner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

describe("LockdownBanner", () => {
  it("displays exact banner text and calls onTurnOff when button clicked", async () => {
    const onTurnOff = vi.fn();
    await act(async () => root.render(<LockdownBanner onTurnOff={onTurnOff} />));

    // Preview spec-v23 index.html:8378
    expect(host.textContent).toContain("Lockdown is on. Trunks can read, but nothing leaves this computer and nothing is changed.");
    expect(host.querySelector("[data-testid=lockdown-banner]")).toBeTruthy();

    const button = host.querySelector("button");
    expect(button?.textContent).toBe("Turn it off");

    await act(async () => button?.click());
    expect(onTurnOff).toHaveBeenCalledOnce();
  });
});
