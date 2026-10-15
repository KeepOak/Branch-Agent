// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GuestBrowser } from "./GuestBrowser";
import { createGuestAccess } from "./guest-access";
import type { GuestEngine } from "./guest-host";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const engine: GuestEngine = {
  request: async () => ({}) as never,
  onEvent: () => () => undefined,
};

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

const render = async (props: Partial<Parameters<typeof GuestBrowser>[0]> = {}) => {
  await act(async () => {
    root!.render(<GuestBrowser bridge={null} {...props} />);
  });
};

const find = <T extends Element>(selector: string) => container.querySelector<T>(selector);

describe("owner's browser pane", () => {
  it("starts empty with the back, forward and reload buttons off", async () => {
    await render();
    expect(container.textContent).toContain("No page is open.");
    expect(find<HTMLButtonElement>('button[aria-label="Back"]')?.disabled).toBe(true);
    expect(find<HTMLButtonElement>('button[aria-label="Reload"]')?.disabled).toBe(true);
    expect(find("webview")).toBeNull();
  });

  it("opens a tab with a webview on the persistent partition when an address is entered", async () => {
    await render();
    const input = find<HTMLInputElement>('input[aria-label="Address"]')!;
    await act(async () => {
      input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(find("webview")).toBeNull();
    const field = find<HTMLInputElement>('input[aria-label="Address"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(field, "https://example.com");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      field.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const webview = find("webview");
    expect(webview?.getAttribute("partition")).toBe("persist:branch-browser");
    expect(webview?.getAttribute("allowpopups")).toBe("true");
    expect(find(".guest-tab")?.getAttribute("data-active")).toBe("true");
  });

  it("shows the consent question once the Trunk asks, and allows on Allow", async () => {
    const access = createGuestAccess();
    await render({ engine, sessionKey: "agent:main:one", access });
    expect(find('[role="dialog"]')).toBeNull();
    await act(async () => access.ask("agent:main:one"));
    expect(container.textContent).toContain("Let your Trunk read and click the pages you open?");
    const allow = [...container.querySelectorAll("button")].find((b) => b.textContent === "Allow")!;
    await act(async () => allow.click());
    expect(access.state("agent:main:one")).toEqual({ access: "allowed", asking: false });
    expect(find('[role="dialog"]')).toBeNull();
  });

  it("lets the owner take over and hand the page back to the Trunk", async () => {
    const access = createGuestAccess();
    access.allow("agent:main:one");
    await render({ engine, sessionKey: "agent:main:one", access, trunkName: "Scout" });
    const take = [...container.querySelectorAll("button")].find((b) => b.textContent === "Take over")!;
    await act(async () => take.click());
    expect(access.state("agent:main:one").access).toBe("owner-control");
    expect(container.textContent).toContain("Hand back to Scout");
  });

  it("hides the pop-out button in the pop-out window", async () => {
    await render({ full: true });
    expect(container.textContent).not.toContain("Open in a window");
  });
});
