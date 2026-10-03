// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PictureDialog } from "./PhotoDialog";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

it("allows a detailed picture request without an invented character cap", async () => {
  const onMake = vi.fn();
  const onClose = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<PictureDialog onMake={onMake} onClose={onClose} />));
  const input = container.querySelector<HTMLInputElement>("input")!;
  expect(input.closest("label")!.textContent).toContain("Describe it");
  const words = "A quiet valley at dawn, with a winding river and soft light. ".repeat(8);
  expect(input.getAttribute("maxlength")).toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const make = [...container.querySelectorAll("button")].find((button) => button.textContent === "Make it")!;
  await act(async () => make.click());
  expect(onMake).toHaveBeenCalledOnce();
  expect(onMake).toHaveBeenCalledWith(words.trim());
  expect(onClose).toHaveBeenCalledOnce();
});
