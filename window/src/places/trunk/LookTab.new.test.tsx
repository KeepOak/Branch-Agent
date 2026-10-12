// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useNewLooks } from "./LookTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function NewLooks() { return <p>{[...useNewLooks()].sort().join(", ")}</p>; }

it("marks newly added looks until the gallery has shown them once", async () => {
  localStorage.removeItem("branch.looks-seen");
  const host = document.body.appendChild(document.createElement("div"));
  let root = createRoot(host);
  await act(async () => root.render(<NewLooks />));
  expect(host.textContent).toBe("nib, skein, sorrel");
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<NewLooks />));
  expect(host.textContent).toBe("");
  await act(async () => root.unmount());
  host.remove();
});
