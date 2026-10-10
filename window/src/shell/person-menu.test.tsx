// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PersonMenu } from "./PersonMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function fns() {
  return {
    onTheme: vi.fn(), onClose: vi.fn(), onSettings: vi.fn(), onShortcuts: vi.fn(), onApps: vi.fn(), onAbout: vi.fn(),
    onGuide: vi.fn(), onAddPerson: vi.fn(), onLock: vi.fn(), onUpdate: vi.fn(),
  };
}

async function show(updateTo: string | null, f = fns()) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<PersonMenu at={{ x: 10, y: 10 }} person="Owner" theme="system" updateTo={updateTo} {...f} />));
  return host;
}

const labels = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("button.mi")].map((b) => b.querySelector(".mi-label")?.textContent ?? "");

it("lists Settings first with its gear, then Look, Help, the apps and Lock; no Achievements or Set up rows", async () => {
  const host = await show(null);
  expect(labels(host)).toEqual(["Settings", "Guide", "Keyboard shortcuts", "About Branch", "Get the apps", "Lock Branch"]);
  expect(host.querySelector("[data-testid=person-settings] svg")).not.toBeNull();
  expect(host.querySelector("button.mi")?.getAttribute("data-testid")).toBe("person-settings");
  expect(host.textContent).not.toContain("Achievements");
  expect(host.textContent).not.toContain("Set up Branch");
});

it("says Install update with the version only when a newer version is waiting", async () => {
  const f = fns();
  const host = await show("0.4.5", f);
  const update = host.querySelector<HTMLButtonElement>("[data-testid=person-update]");
  expect(update?.textContent).toContain("Install update");
  expect(update?.textContent).toContain("Branch 0.4.5");
  await act(async () => update?.click());
  expect(f.onUpdate).toHaveBeenCalledOnce();
  expect(f.onClose).toHaveBeenCalledOnce();
});

it("shows no update row when nothing newer is waiting", async () => {
  const host = await show(null);
  expect(host.querySelector("[data-testid=person-update]")).toBeNull();
});
