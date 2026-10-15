// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Block } from "../thread/model";
import { JobLine } from "./JobLine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

const line: Extract<Block, { kind: "notice" }> = {
  kind: "notice",
  key: "room:r1:job:j1",
  text: "nas-builder-2 finished: Quote sheet, PR #41",
  at: 1_700_000_000_000,
  steps: [
    { key: "job:2", text: "nas-builder-2 picked up: Quote sheet", at: 1_699_999_000_000 },
    { key: "job:3", text: "nas-builder-2 finished: Quote sheet, PR #41", at: 1_700_000_000_000 },
  ],
};

async function render(block: Extract<Block, { kind: "notice" }>): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<JobLine block={block} />));
  return host;
}

describe("JobLine", () => {
  it("shows only the latest state in plain words, collapsed by default", async () => {
    const host = await render(line);
    const head = host.querySelector<HTMLButtonElement>(".jf-head")!;
    expect(head.textContent).toBe("nas-builder-2 finished: Quote sheet, PR #41");
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("[data-testid='job-steps']")).toBeNull();
    expect(host.textContent).not.toContain("j1");
  });

  it("expands to every transition with its time, and collapses again", async () => {
    const host = await render(line);
    const head = host.querySelector<HTMLButtonElement>(".jf-head")!;
    await act(async () => head.click());
    expect(head.getAttribute("aria-expanded")).toBe("true");
    const steps = host.querySelectorAll("[data-testid='job-steps'] li");
    expect(steps).toHaveLength(2);
    expect(steps[0]!.textContent).toContain("nas-builder-2 picked up: Quote sheet");
    expect(steps[0]!.querySelector("time")).not.toBeNull();
    await act(async () => head.click());
    expect(host.querySelector("[data-testid='job-steps']")).toBeNull();
  });
});
