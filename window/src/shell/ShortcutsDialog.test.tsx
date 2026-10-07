// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ShortcutsDialog } from "./ShortcutsDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function show(platform: string) {
  const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
  Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => platform });
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<ShortcutsDialog onClose={() => undefined} />));
  if (desc) Object.defineProperty(Navigator.prototype, "platform", desc);
  return host;
}

function fixedKeys(host: HTMLElement, label: string): string[] | null {
  const spans = [...(host.querySelector(".shortcuts.k-fixed15")?.children ?? [])] as HTMLElement[];
  for (let i = 0; i < spans.length; i += 2) {
    const what = spans[i].childNodes[0]?.textContent ?? spans[i].textContent;
    if (what === label) {
      return [...spans[i + 1].querySelectorAll("kbd")].map((k) => k.textContent ?? "");
    }
  }
  return null;
}

describe("ShortcutsDialog hide-or-show list", () => {
  it("lists Hide or show the list with Ctrl B", async () => {
    const host = await show("Win32");
    expect(fixedKeys(host, "Hide or show the list")).toEqual(["Ctrl", "B"]);
    const labels = [...(host.querySelector(".shortcuts.k-fixed15")?.children ?? [])]
      .filter((_, i) => i % 2 === 0)
      .map((el) => el.childNodes[0]?.textContent ?? el.textContent);
    expect(labels.indexOf("Hide or show the list")).toBe(labels.indexOf("Find in this conversation") + 1);
  });

  it("lists Hide or show the list with ⌘ B on a Mac", async () => {
    const host = await show("MacIntel");
    expect(fixedKeys(host, "Hide or show the list")).toEqual(["⌘", "B"]);
  });
});
