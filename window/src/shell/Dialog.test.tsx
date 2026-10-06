// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("dialog final-pass actions", () => {
  it("keeps the header close and primary action without a duplicate footer Close", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const close = vi.fn();
    const primary = vi.fn();
    await act(async () => root.render(<Dialog title="Example" onClose={close} footer={<><button onClick={close}>Close</button><button onClick={primary}>Continue</button></>}><p>Body</p></Dialog>));
    expect([...host.querySelectorAll(".dlg-f button")].map((button) => button.textContent)).toEqual(["Continue"]);
    expect(host.querySelector<HTMLButtonElement>('.dlg-h button[aria-label="Close"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".dlg-f button")!.click());
    expect(primary).toHaveBeenCalledOnce();
    await act(async () => host.querySelector<HTMLButtonElement>(".dlg-h button")!.click());
    expect(close).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    host.remove();
  });

  it("uses the header close when Close was the only footer action", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const close = vi.fn();
    await act(async () => root.render(<Dialog title="Details" onClose={close} footer={<button onClick={close}>Close</button>}><p>Body</p></Dialog>));
    expect(host.querySelector(".dlg-f")).toBeNull();
    expect(document.activeElement).toBe(host.querySelector(".dlg-h button"));
    await act(async () => root.unmount());
    host.remove();
  });
});
