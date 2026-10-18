// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Devices } from "./devices";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const previousLevel = localStorage.getItem("branch.level");
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  if (previousLevel === null) localStorage.removeItem("branch.level");
  else localStorage.setItem("branch.level", previousLevel);
});

it("shows a device loading error in plain words and keeps the retry action", async () => {
  localStorage.setItem("branch.level", "regular");
  const request = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
  const engine: WindowEngine = {
    request: request as WindowEngine["request"],
    onEvent: () => () => {},
    sessionKey: null,
    scopes: [],
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Devices engine={engine} level="regular" />); });

  expect(host.querySelector('[role="alert"] p')?.textContent).toBe(
    "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.",
  );
  expect(host.textContent).not.toContain("ECONNREFUSED");
  const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button');
  expect(retry?.textContent).toBe("Try again");
  await act(async () => { retry!.click(); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith("device.pair.list", {});
});
