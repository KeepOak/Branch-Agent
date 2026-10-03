// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { SettingsFrame } from "./SettingsFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const engine: WindowEngine = { request: vi.fn(async () => ({})) as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "test", scopes: [] };
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

async function open(page: string, onPage = vi.fn()) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<SettingsFrame page={page} backName="Sapling" engine={engine} onPage={onPage} onBack={() => {}} />));
  return onPage;
}

describe("settings frame level", () => {
  it("opening an Advanced page at Regular raises the level and shows that page", async () => {
    localStorage.setItem("branch.level", "regular");
    const onPage = await open("advanced");
    expect(document.querySelector('[data-level="advanced"]')?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('.set-item[data-page="advanced"]')?.getAttribute("aria-current")).toBe("true");
    expect(localStorage.getItem("branch.level")).toBe("advanced");
    expect(onPage).not.toHaveBeenCalledWith("general");
  });

  it("lowering the level by hand still moves a hidden page to General", async () => {
    localStorage.setItem("branch.level", "advanced");
    const onPage = await open("advanced");
    await act(async () => (document.querySelector('[data-level="regular"]') as HTMLButtonElement).click());
    expect(onPage).toHaveBeenCalledWith("general");
  });

  it("a row found by search opens its page at the level that shows it", async () => {
    localStorage.setItem("branch.level", "regular");
    const onPage = await open("general");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "region"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const hit = document.querySelector<HTMLButtonElement>('[data-row-hit="Region"]')!;
    expect(hit.textContent).toContain("Technical");
    await act(async () => hit.click());
    expect(onPage).toHaveBeenCalledWith("accounts");
    expect(localStorage.getItem("branch.level")).toBe("technical");
  });

  it("a row found by search gets focus on its own control, not on its pin", async () => {
    localStorage.setItem("branch.level", "regular");
    Element.prototype.scrollIntoView = vi.fn(); // jsdom has no layout
    await open("general");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "finish setting"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => document.querySelector<HTMLButtonElement>('[data-row-hit="Show “Finish setting up”"]')!.click());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const row = document.querySelector('.set-col [data-row="Show “Finish setting up”"]')!;
    expect(row.querySelector(".pin-k")).not.toBeNull();
    expect(document.activeElement).toBe(row.querySelector('input[role="switch"]'));
  });

  it("says no setting matches", async () => {
    await open("general");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "zzzz"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(document.querySelector(".set-nomatch")?.textContent).toBe("No setting matches.");
  });

  it("someone who may not change setup doesn't see the setup-only pages", async () => {
    const plain = { ...engine, scopes: ["operator.read"] } as WindowEngine;
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root?.render(<SettingsFrame page="gateway" backName="Sapling" engine={plain} onPage={vi.fn()} onBack={() => {}} />));
    expect(document.querySelector('.set-item[data-page="gateway"]')).toBeNull();
    expect(document.querySelector('.set-item[data-page="general"]')?.getAttribute("aria-current")).toBe("true");
  });
});
