// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HoverBar, type HoverActions } from "./HoverBar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function mount(isReply: boolean) {
  const run = vi.fn();
  const actions: HoverActions = {
    copy: { run, disabled: null },
    copyRequestId: { run, disabled: null },
    retry: { run, disabled: null },
    edit: { run, disabled: null },
    reply: { run, disabled: null },
    react: run,
    reactDisabled: null,
    inspect: { run, disabled: null },
    branch: { run, disabled: null },
    context: { run, disabled: null, excluded: false },
    read: { run, disabled: null, reading: false },
  };
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<HoverBar isReply={isReply} actions={actions} />));
  return { host, run };
}

describe("P54 message toolbar", () => {
  it.each([true, false])("shows only five direct actions for isReply=%s", async (isReply) => {
    const { host } = await mount(isReply);
    expect([...host.querySelectorAll<HTMLButtonElement>(".hb-btn")].map((b) => b.getAttribute("aria-label")))
      .toEqual(["Copy", "Reply", "React", "Pin", "More"]);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Pin"]')?.disabled).toBe(true);
  });

  it("groups reply actions under More and keeps working actions wired", async () => {
    const { host, run } = await mount(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More"]')?.click());
    expect([...document.body.querySelectorAll(".pop-head")].map((x) => x.textContent)).toEqual(["Reply tools", "Inspect", "Context", "Feedback", "Share"]);
    const labels = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((x) => x.textContent);
    expect(labels).toEqual(["Try again", "Branch from here", "Ask another model", "Every step behind this reply", "Read aloud", "Leave out of context", "Good reply", "Bad reply", "Flag", "Copy request ID", "As a picture", "To a coding app", "Delete"]);
    await act(async () => document.body.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click());
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([true, false])("copies the request ID from any message menu (reply=%s)", async (isReply) => {
    const { host, run } = await mount(isReply);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More"]')?.click());
    const copy = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Copy request ID");
    await act(async () => copy?.click());
    expect(run).toHaveBeenCalledOnce();
  });

  it("leaves out groups with nothing for your own message (no empty Inspect or Feedback heading)", async () => {
    const { host } = await mount(false);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More"]')?.click());
    expect([...document.body.querySelectorAll(".pop-head")].map((x) => x.textContent)).toEqual(["Reply tools", "Context", "Share"]);
    expect(document.body.querySelectorAll(".msep")).toHaveLength(3);
  });

  it("moves Edit into the user-message menu", async () => {
    const { host, run } = await mount(false);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More"]')?.click());
    expect(document.body.querySelector<HTMLButtonElement>('[role="menuitem"]')?.textContent).toBe("Edit");
    expect([...document.body.querySelectorAll(".pop-head")].map((x) => x.textContent)).toEqual(["Reply tools", "Context", "Share"]);
    await act(async () => document.body.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click());
    expect(run).toHaveBeenCalledOnce();
  });

  it("runs the context action and gives disabled actions a plain reason", async () => {
    const { host, run } = await mount(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More"]')?.click());
    const context = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === "Leave out of context");
    await act(async () => context?.click());
    expect(run).toHaveBeenCalledOnce();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More"]')?.click());
    const disabled = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === "Good reply");
    expect(disabled?.getAttribute("aria-disabled")).toBe("true");
    expect(disabled?.title).toBe("Reply feedback isn't available here yet.");
  });

  it("keeps the More menu inside the viewport near its lower edge", async () => {
    const { host } = await mount(true);
    const bar = host.querySelector<HTMLElement>(".hover-bar")!;
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({ left: 900, right: 940, top: 680, bottom: 708 } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 300 } as DOMRect);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 960 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 720 });
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More"]')?.click());
    const portal = document.body.querySelector<HTMLElement>(".menu-portal")!;
    expect(Number.parseInt(portal.style.left)).toBeGreaterThanOrEqual(8);
    expect(Number.parseInt(portal.style.left) + Number.parseInt(portal.style.width)).toBeLessThanOrEqual(952);
    expect(Number.parseInt(portal.style.top)).toBeGreaterThanOrEqual(8);
    expect(Number.parseInt(portal.style.top) + 300).toBe(674);
  });
});
