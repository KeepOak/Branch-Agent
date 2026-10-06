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
});

async function mount(isReply: boolean) {
  const run = vi.fn();
  const actions: HoverActions = {
    copy: { run, disabled: null },
    retry: { run, disabled: null },
    edit: { run, disabled: null },
    reply: { run, disabled: null },
    react: run,
    reactDisabled: null,
    inspect: { run, disabled: null },
    branch: { run, disabled: null },
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
    expect([...host.querySelectorAll(".pop-head")].map((x) => x.textContent)).toEqual(["Reply tools", "Inspect", "Context", "Feedback", "Share"]);
    const labels = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((x) => x.textContent);
    expect(labels).toEqual(["Try again", "Branch from here", "Ask another model", "Every step behind this reply", "Read aloud", "Leave out of context", "Good reply", "Bad reply", "Flag", "As a picture", "To a coding app", "Delete"]);
    await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click());
    expect(run).toHaveBeenCalledOnce();
  });

  it("moves Edit into the user-message menu", async () => {
    const { host, run } = await mount(false);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="More"]')?.click());
    expect(host.querySelector<HTMLButtonElement>('[role="menuitem"]')?.textContent).toBe("Edit");
    await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click());
    expect(run).toHaveBeenCalledOnce();
  });
});
