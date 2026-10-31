// @vitest-environment jsdom
// Classic, no model: the composer's free model card (Try again / Cancel) sits below the thread. The empty state must
// keep Connect a model in view above it, never slid under the card at the bottom edge of the scroll area.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ noModel: true }));
vi.mock("../composer/useConversation", () => ({
  useConversation: () => ({ loaded: true, row: {}, defaults: {}, models: [], modelsLoaded: true, modelsError: null, error: null, trunk: null }),
  hasNoModel: () => state.noModel,
}));
vi.mock("../composer/model", () => ({ currentModelRef: () => "" }));
vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("./context", () => ({ useThread: () => ({ name: "Sapling", engine: undefined }) }));

import { EmptyState } from "./EmptyState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const css = readFileSync("src/thread/empty.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const declarations = (selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s!.split(",").some((one) => one.trim() === selector)).map(([, , d]) => d!).join(";");

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  state.noModel = true;
  document.body.innerHTML = "";
});

async function mount() {
  const host = document.createElement("div");
  host.className = "thread";
  document.body.append(host);
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  root = createRoot(host);
  await act(async () => { root!.render(<EmptyState onStart={() => {}} />); });
  return host;
}

describe("Classic empty chat with no model keeps Connect a model clear of the free model card", () => {
  it("marks the empty state as no model and keeps the button inside the connect notice", async () => {
    const host = await mount();
    const empty = host.querySelector<HTMLElement>('[data-testid="empty-state"]')!;
    expect(empty.classList.contains("empty-nomodel")).toBe(true);
    const notice = empty.querySelector<HTMLElement>(".empty-connect")!;
    expect([...notice.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Connect a model"]);
  });

  it("pins the connect notice to the bottom of the scroll area on a solid backing", async () => {
    const host = await mount();
    const notice = host.querySelector<HTMLElement>(".empty-nomodel .empty-connect")!;
    expect(getComputedStyle(notice).position).toBe("sticky");
    const rule = declarations(".thread .empty.empty-nomodel .empty-connect");
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/bottom:\s*0\b/);
    expect(rule).toMatch(/z-index:\s*[1-9]/);
    // Ends in the page colour, so the face and title scroll behind it instead of showing through the button row.
    expect(rule).toMatch(/background:[^;]*var\(--bg\)/);
  });

  it("starts the no model empty state higher so the button fits above the card in a normal window", () => {
    const rule = declarations(".thread .empty.empty-nomodel");
    expect(rule).toMatch(/padding-top:\s*min\(12vh,\s*\d+px\)/);
  });

  it("leaves the empty state with a model as it was", async () => {
    state.noModel = false;
    const host = await mount();
    const empty = host.querySelector<HTMLElement>('[data-testid="empty-state"]')!;
    expect(empty.classList.contains("empty-nomodel")).toBe(false);
    expect(host.querySelector(".empty-connect")).toBeNull();
  });
});
