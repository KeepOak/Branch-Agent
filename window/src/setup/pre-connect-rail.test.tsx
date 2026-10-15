// @vitest-environment jsdom
// Before the window connects, the rail shows the preview's four first-run steps (preview item 37), not the eleven setup steps
// (QA main walk: a fresh launch showed the old "Set up Branch" rail). Only Welcome is reachable before a connection.
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

it("draws the four first-run steps on the pre-connect rail, with only Welcome reachable", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(
    <PreConnect local="ws://127.0.0.1:18789" address={null} state={{ kind: "address" }} busy={false} onConnect={() => undefined} onRetry={() => undefined} />,
  ));
  const items = [...host.querySelectorAll<HTMLLIElement>(".ob-rail li")];
  expect(items.map((li) => li.textContent?.replace(/^\d+/, "").trim())).toEqual(["Welcome", "Your models", "How much it may do", "Your first Trunk"]);
  expect(items[0]!.className).toBe("now");
  const buttons = items.map((li) => li.querySelector("button")!);
  expect(buttons.slice(1).every((b) => b.disabled)).toBe(true);
});
