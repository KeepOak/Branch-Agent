// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckButton } from "./checked-at";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function render(run: () => Promise<boolean>) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<CheckButton run={run}>Check again</CheckButton>));
}
async function click() {
  await act(async () => document.querySelector<HTMLButtonElement>("button")?.click());
  await act(async () => undefined);
}

describe("check buttons say when they last checked", () => {
  it("shows no line before a check, and a Checked at time once the check succeeds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15, 14, 5));
    await render(async () => true);
    expect(document.querySelector(".checked-at")).toBeNull();
    await click();
    expect(document.querySelector(".checked-at")?.textContent).toMatch(/^Checked at \d{1,2}:05/);
  });

  it("does not stamp when the loader resolves with an error state (a failed read resolves false)", async () => {
    // useResource, configStore.load and the accounts read all resolve when the engine call fails; they report it in
    // their error state and resolve false, so the button must not say it checked.
    await render(async () => false);
    await click();
    expect(document.querySelector(".checked-at")).toBeNull();
    expect(document.querySelector("button")?.textContent).toBe("Check again");
  });

  it("does not stamp when the check throws", async () => {
    await render(async () => { throw new Error("offline"); });
    await click();
    expect(document.querySelector(".checked-at")).toBeNull();
  });
});
