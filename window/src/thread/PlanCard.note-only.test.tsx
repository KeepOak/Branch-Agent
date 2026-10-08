// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanCard, readProgressCard, type ProgressCard } from "./PlanCard";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => vi.stubGlobal("IntersectionObserver", class {
  observe() {}
  disconnect() {}
}));
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const sessionKey = "agent:scout:one";
const note = "Source-only update.\n- This note is not a tracked task.\nSee [PR 74](https://github.com/KeepOak/Branch-Agent/pull/74).";
async function render(payload: unknown, onRefresh?: () => void, onDismiss?: () => void) {
  const card = readProgressCard(payload, sessionKey);
  if (!card) throw new Error("Expected a native admitted progress-card value");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<PlanCard card={card} onRefresh={onRefresh} onDismiss={onDismiss} />));
}

describe("native admitted progress-card rendering", () => {
  it.each([{ label: "missing steps", steps: undefined }, { label: "empty steps", steps: [] }])("shows $label without a fabricated zero-task plan", async ({ steps }) => {
    await render({ sessionKey, revision: 2, updatedAt: 1000, markdown: note, ...(steps ? { steps } : {}) });
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Progress update");
    expect(container.querySelector(".plan-h b")?.textContent).toBe("Progress update");
    expect(container.querySelector(".plan-h .plan-n")).toBeNull();
    expect(container.textContent).not.toContain("0 of 0");
    expect(container.querySelector(".plan-end")).toBeNull();
    expect(container.querySelector("ul.plan")).toBeNull();
    expect(container.querySelector(".plan-note")?.lastChild?.textContent).toBe(note);
  });

  it("retains note-only refresh/dismiss callbacks and the original note", async () => {
    const refresh = vi.fn(), dismiss = vi.fn();
    await render({ sessionKey, revision: 2, updatedAt: 1000, markdown: note }, refresh, dismiss);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Refresh"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!.click());
    expect(refresh).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(container.querySelector(".plan-note")?.lastChild?.textContent).toBe(note);
  });

  it("keeps the actual completion fraction and states for a nonempty plan", async () => {
    const steps: NonNullable<ProgressCard["steps"]> = [
      { step: "Read source", status: "completed" },
      { step: "Verify behavior", status: "in_progress" },
      { step: "Publish proof", status: "pending" },
    ];
    await render({ sessionKey, revision: 3, updatedAt: 2000, markdown: note, steps });
    expect(container.querySelector(".plan-h b")?.textContent).toBe("Plan");
    expect(container.querySelector(".plan-n")?.textContent).toBe("1 of 3 done");
    expect([...container.querySelectorAll(".plan li")].map((row) => row.getAttribute("data-state"))).toEqual(["completed", "in_progress", "pending"]);
    expect(container.querySelector(".plan-end")).toBeNull();
  });

  it("keeps the recorded done state for a completed nonempty plan", async () => {
    await render({ sessionKey, revision: 4, updatedAt: 3000, steps: [
      { step: "Read source", status: "completed" },
      { step: "Verify behavior", status: "completed" },
    ] });
    expect(container.querySelector(".plan-n")?.textContent).toBe("2 of 2 done");
    expect(container.querySelector(".plan-end")?.textContent).toBe("Done");
    expect(container.querySelectorAll(".plan li")).toHaveLength(2);
  });
});
