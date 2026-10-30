// @vitest-environment jsdom
import { createRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { ModeMenu } from "./ModeMenu";
import { PLAN_FIRST_REASON } from "./mode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

it("shows why Plan first is off", async () => {
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
      onPick={() => undefined}
      row={{}}
      onElevated={() => undefined}
    />,
  ));
  const plan = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="mode-option"]')].find((el) => el.textContent?.includes("Plan first"));
  expect(plan).toBeTruthy();
  expect(plan!.disabled).toBe(true);
  expect(plan!.textContent).toContain(PLAN_FIRST_REASON);
  expect(plan!.querySelector("small")?.textContent).toBe("Plan first comes in a later update.");
  expect(plan!.textContent).not.toMatch(/Update Branch/i);
});
