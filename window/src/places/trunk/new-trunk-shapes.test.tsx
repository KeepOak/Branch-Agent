import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NewTrunkSheet } from "./NewTrunkSheet";

vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
});

it("gives all five New Trunk shapes visible names and distinct silhouettes", async () => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root!.render(<NewTrunkSheet count={0} onClose={() => {}} onCreate={() => {}} />));
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Shape"] button')];
  expect(buttons.map((button) => button.textContent?.trim())).toEqual(["Circle", "Stone", "Leaf", "Acorn", "Shield"]);
  const silhouettes = buttons.map((button) => button.querySelector("svg path")?.getAttribute("d"));
  expect(silhouettes.every(Boolean)).toBe(true);
  expect(new Set(silhouettes).size).toBe(5);
  for (const button of buttons) {
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    await act(async () => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(buttons.filter((item) => item.getAttribute("aria-pressed") === "true")).toEqual([button]);
    expect(document.querySelector('[role="status"]')?.textContent).toContain(button.textContent);
  }
});
