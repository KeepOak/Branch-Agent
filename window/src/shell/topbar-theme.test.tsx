// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

it("has no theme button in the top bar; Look lives in the profile menu", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<TopBar compact={false} machine={null} header={null} dark={false} listHidden={false} onToggleList={vi.fn()} />));
  expect(host.querySelector("[data-testid=theme]")).toBeNull();
  expect(host.querySelector("[data-testid=list-toggle]")).not.toBeNull();
});
