// @vitest-environment jsdom
// P54 #31: every in-progress phase shows only the avatar and dots.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Typing } from "./blocks";

vi.mock("../face/Face", () => ({ Face: () => <span data-testid="face" /> }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function renderPhase(phase: string, attempt?: number, maxAttempts?: number): Promise<Element | null> {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  void phase; void attempt; void maxAttempts;
  await act(async () => root?.render(<Typing name="Research" />));
  return host.querySelector('[data-testid="typing"]');
}

describe("typing indicator", () => {
  it.each(["preparing_context", "starting_model", "waiting_for_state", "creating_worktree"])("phase %s shows only the face and the dots", async (phase) => {
    const typing = await renderPhase(phase);
    expect(typing?.querySelector('[data-testid="face"]')).not.toBeNull();
    expect(typing?.querySelectorAll(".typing i")).toHaveLength(3);
    expect(typing?.querySelector(".typing-words")).toBeNull();
    expect(typing?.textContent).toBe("");
  });

  it("a retry also shows only the face and dots", async () => {
    const typing = await renderPhase("starting_model", 2, 3);
    expect(typing?.querySelector(".typing-words")).toBeNull();
    expect(typing?.textContent).toBe("");
  });

  it("shows avatar and dots in a group without a typing caption", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<Typing name="Research" />));
    expect(host.querySelector(".typing-who")).toBeNull();
    expect(host.querySelectorAll(".typing i")).toHaveLength(3);
    expect(host.querySelector(".typing-words")).toBeNull();
  });
});
