// @vitest-environment jsdom
// Before the window connects, Welcome is the preview's glass card with four first-run dots, not the eleven-step rail.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { PreConnect } from "./PreConnect";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  sessionStorage.clear();
});

it("draws the four first-run steps as dots on the pre-connect card, with only Welcome current", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(
    <PreConnect local="ws://127.0.0.1:18789" address={null} state={{ kind: "address" }} busy={false} onConnect={() => undefined} onRetry={() => undefined} />,
  ));
  expect(host.querySelector(".ob-rail")).toBeNull();
  const dots = [...host.querySelectorAll<HTMLElement>(".ob-dots i")];
  expect(dots.map((dot) => dot.title)).toEqual(["Welcome", "Your models", "How much it may do", "Your first Trunk"]);
  expect(dots[0]!.className).toBe("on");
  expect(dots.slice(1).every((dot) => dot.className === "")).toBe(true);
  expect(host.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("1");
  expect(host.querySelector("[role=progressbar]")?.getAttribute("aria-valuemax")).toBe("4");
});
