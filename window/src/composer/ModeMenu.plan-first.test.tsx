// @vitest-environment jsdom
// #1769: Branch never shows a choice that can't work. Plan first has no engine mode yet, so the
// composer's mode menu leaves it out; once its row names an engine mode it shows again on its own.
import { createRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ModeRow } from "./mode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.doUnmock("./mode");
  vi.resetModules();
});

async function openMenu(onPick: (mode: unknown) => void = () => undefined) {
  const { ModeMenu } = await import("./ModeMenu");
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const anchor = createRef<HTMLElement>();
  await act(async () => root?.render(
    <ModeMenu
      embedded
      anchor={anchor}
      onClose={() => undefined}
      mode={null}
      asSet={null}
      canSelectFull
      onPick={onPick}
      row={{}}
      onElevated={() => undefined}
    />,
  ));
  return [...host.querySelectorAll<HTMLButtonElement>('[data-testid="mode-option"]')];
}

it("leaves Plan first out while the engine has no such mode", async () => {
  const onPick = vi.fn();
  const options = await openMenu(onPick);
  expect(options.map((el) => el.textContent ?? "").some((text) => text.includes("Plan first"))).toBe(false);
  expect(document.body.textContent).not.toContain("Plan first comes in a later update.");
  const names = ["As set", "Auto", "Ask first", "Read only", "Full access"];
  expect(options.map((el) => names.find((name) => el.textContent?.includes(name)))).toEqual(names);
  // Number keys follow the rows shown: 3 is Read only now.
  await act(async () => {
    options[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "3", bubbles: true }));
  });
  expect(onPick).toHaveBeenCalledWith("read-only");
});

it("shows Plan first again once its row names an engine mode", async () => {
  vi.doMock("./mode", async (importOriginal) => {
    const original = await importOriginal<typeof import("./mode")>();
    const rows = original.MODE_ROWS.map((row): ModeRow => (row.name === "Plan first" ? { ...row, engine: "plan-first" as ModeRow["engine"], gap: undefined } : row));
    return { ...original, MODE_ROWS: rows, offeredModeRows: (given: readonly ModeRow[] = rows) => original.offeredModeRows(given) };
  });
  const options = await openMenu();
  const plan = options.find((el) => el.textContent?.includes("Plan first"));
  expect(plan).toBeTruthy();
  expect(plan!.disabled).toBe(false);
  expect(options).toHaveLength(6);
});
