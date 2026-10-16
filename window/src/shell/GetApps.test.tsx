// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "./shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET_IT_OFF, GetAppsDialog } from "./GetApps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop;
});
const render = () => act(async () => root.render(<GetAppsDialog onClose={() => undefined} onPair={() => undefined} />));
const getIt = () => [...document.querySelectorAll<HTMLButtonElement>(".appsPA18 .tile button")];

describe("Get the apps", () => {
  it("greys Get it in a plain browser, and Coming soon has no button", async () => {
    await render();
    expect(getIt()).toHaveLength(4);
    for (const b of getIt()) { expect(b.disabled).toBe(true); expect(b.title).toBe(GET_IT_OFF); }
    const soon = [...document.querySelectorAll(".appsPA18 .tile")].filter((tile) => tile.textContent?.includes("Coming soon"));
    expect(soon.map((tile) => tile.querySelector("b")?.textContent)).toEqual(["iPhone", "Browser extension"]);
    for (const tile of soon) {
      expect(tile.querySelector("button, a")).toBeNull();
    }
  });

  it("greys Get it for an older Branch app, without a developer note", async () => {
    (window as { branchDesktop?: unknown }).branchDesktop = {};
    await render();
    for (const b of getIt()) { expect(b.disabled).toBe(true); expect(b.title).toBe(""); }
    expect(visibleDevNotes(document.body)).toEqual([]);
  });

  it("asks the Branch app to open each app's download page", async () => {
    const openDownload = vi.fn(async (_id: string) => undefined);
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { openDownload } };
    await render();
    for (const b of getIt()) { expect(b.disabled).toBe(false); await act(async () => b.click()); }
    expect(openDownload.mock.calls.map(([id]) => id)).toEqual(["android", "mac", "windows", "linux"]);
  });
});
