// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { headerOverlay, startDesktopTitleBar, syncTitleBar, type TitleBarOverlay } from "./title-bar";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  delete (window as { branchDesktop?: unknown }).branchDesktop;
});

function topBar(height: number): HTMLElement {
  const right = document.body.appendChild(document.createElement("div"));
  right.className = "topbar-right";
  right.style.setProperty("--bg", "#0f1418");
  right.style.setProperty("--ink-2", "#aebac3");
  Object.defineProperty(right, "clientHeight", { value: height });
  return right;
}

describe("the header-integrated title bar", () => {
  it("matches the overlay to the top bar's background, icon colour and height", () => {
    topBar(51);
    expect(headerOverlay()).toEqual({ color: "#0f1418", symbolColor: "#aebac3", height: 51 });
  });

  it("uses the bar's height on screens without the top bar", () => {
    expect(headerOverlay().height).toBe(51);
  });

  it("sends the overlay only when it changed, and the drag strip follows its height", () => {
    const set = vi.fn<(o: TitleBarOverlay) => void>();
    (window as { branchDesktop?: unknown }).branchDesktop = { titleBar: { set } };
    topBar(33);
    syncTitleBar();
    syncTitleBar();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0].height).toBe(33);
    expect(document.documentElement.style.getPropertyValue("--titlebar-h")).toBe("33px");
  });

  it("does nothing in a plain browser", () => {
    startDesktopTitleBar();
    expect(document.documentElement.classList.contains("desktop-titlebar")).toBe(false);
    expect(document.querySelector(".desktop-drag-strip")).toBeNull();
  });

  it("inside the app, marks the page and puts the drag strip first so later controls stay clickable", () => {
    (window as { branchDesktop?: unknown }).branchDesktop = { titleBar: { set: vi.fn() } };
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined }));
    document.body.appendChild(document.createElement("main"));
    startDesktopTitleBar();
    expect(document.documentElement.classList.contains("desktop-titlebar")).toBe(true);
    expect(document.body.firstElementChild?.className).toBe("desktop-drag-strip");
  });
});
