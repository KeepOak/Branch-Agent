// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DockRow } from "./DockRow";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

it.each(["active", "paused"])("holds %s goal controls offline and restores them when connected", async (status) => {
  const onGoal = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const props = {
    trunkName: "Branch", working: false, line: [], jobs: [], files: [], preparing: 0, people: [],
    goal: { id: "g", objective: "Finish the garden plan", status, rounds: 2, note: "" },
    onGoal, onReword: vi.fn(), onMoveUp: vi.fn(), onRemove: vi.fn(), onSteerQueued: vi.fn(),
    onRetry: vi.fn(), onStopJob: vi.fn(), onRemoveFile: vi.fn(), onShowText: vi.fn(),
    onForget: vi.fn(), onSteer: vi.fn(),
  };
  await act(async () => root.render(<DockRow {...props} offline />));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="goal-chip"]')!.click());
  const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label)!;
  const action = status === "paused" ? "Resume" : "Pause";
  for (const label of ["Edit", action, "Clear"]) {
    expect(button(label).disabled).toBe(true);
    await act(async () => button(label).click());
  }
  expect(onGoal).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Offline. Goal changes wait until Branch is back.");
  await act(async () => root.render(<DockRow {...props} offline={false} />));
  expect(button(action).disabled).toBe(false);
  await act(async () => button(action).click());
  expect(onGoal).toHaveBeenCalledWith(status === "paused" ? "resume" : "pause");
  onGoal.mockClear();
  await act(async () => button("Edit").click());
  await act(async () => root.render(<DockRow {...props} offline />));
  expect(button("Save goal").disabled).toBe(true);
  await act(async () => button("Save goal").click());
  expect(onGoal).not.toHaveBeenCalled();
  await act(async () => root.render(<DockRow {...props} offline={false} />));
  await act(async () => button("Save goal").click());
  expect(onGoal).toHaveBeenCalledWith("edit", props.goal.objective);
});
