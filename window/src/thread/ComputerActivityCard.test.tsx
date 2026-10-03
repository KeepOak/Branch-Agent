// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ComputerActivityCard } from "./ComputerActivityCard";
import type { Block } from "./model";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
const step = (key: string, title: string, status: "ok" | "running"): Block => ({ kind: "step", key, tool: "computer", title, detail: `${title} detail`, status });
async function render(blocks: Block[], running: boolean, onWatch = vi.fn()) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<ComputerActivityCard blocks={blocks} running={running} name="Ada" onWatch={onWatch} />));
  return onWatch;
}

describe("computer card in the conversation", () => {
  it("groups finished actions and lists each one when opened", async () => {
    await render([step("a", "Opened mail", "ok"), step("b", "Clicked Sign in", "ok")], false);
    expect(container.textContent).toContain("Used Ada's computer · 2 actions");
    expect(container.textContent).toContain("Opened mail, Clicked Sign in");
    await act(async () => container.querySelector<HTMLButtonElement>(".acts-head-st")!.click());
    expect(container.querySelectorAll(".acts-list-st li")).toHaveLength(2);
  });
  it("shows the live card while a computer step runs, with Watch full size", async () => {
    const onWatch = await render([step("a", "Searching the inbox", "running")], true);
    expect(container.textContent).toContain("Working");
    const watch = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Watch full size"))!;
    await act(async () => watch.click());
    expect(onWatch).toHaveBeenCalledWith("Computer");
  });
});
