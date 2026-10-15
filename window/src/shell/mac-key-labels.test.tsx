// @vitest-environment jsdom
// DA-114: on a Mac the palette and menus wrote "Ctrl N" while the search field and shortcuts dialog wrote ⌘.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Menu } from "./Menu";
import { newMenuItems } from "./new-menu";
import { Palette } from "./Palette";
import { paletteRows } from "./palette-rows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;
const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
let root: Root | undefined;

function onPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { configurable: true, get: () => value });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  delete (navigator as { platform?: string }).platform;
  if (platform) Object.defineProperty(Navigator.prototype, "platform", platform);
});

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

const rows = () => paletteRows({
  conversations: [], trunks: [], trunkName: () => "Oak", newConversation: noop, toggleTheme: noop, focusMode: noop,
  shortcuts: noop, setup: noop, tour: noop, quickAsk: noop, openConversation: noop, openPlace: noop, openSettings: noop, newTrunk: noop,
});

const hints = (host: HTMLElement, cls: string) => Object.fromEntries(
  Array.from(host.querySelectorAll(cls)).map((el) => [el.parentElement?.querySelector("span")?.textContent ?? "", el.textContent ?? ""]),
);

describe("Mac key labels (DA-114)", () => {
  it("Find anything writes ⌘ on a Mac, never Ctrl", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
    onPlatform("MacIntel");
    const host = await render(<Palette rows={rows()} request={(async () => ({ results: [] })) as never} rowName={() => "Oak"} onOpenMessage={noop} onClose={noop} />);
    const shown = hints(host, ".pal-hint");
    expect(shown["New conversation"]).toBe("⌘N");
    expect(shown["Focus mode"]).toBe("⌘.");
    expect(shown["Quick ask"]).toBe("⌘⇧Space");
    expect(host.textContent).not.toContain("Ctrl");
  });

  it("the + new menu writes ⌘ on a Mac", async () => {
    onPlatform("MacIntel");
    const items = newMenuItems({ newWith: noop, trunks: [{ id: "oak", name: "Oak" }], defaultId: "oak", newTrunk: noop, openPlace: noop, makeTrunk: noop, quickAsk: noop });
    const host = await render(<Menu at={{ x: 0, y: 0 }} items={items} onClose={noop} label="New" />);
    expect(host.textContent).toContain("⌘N");
    expect(host.textContent).toContain("⌘⇧Space");
    expect(host.textContent).not.toContain("Ctrl");
  });

  it("keeps Ctrl on Windows and Linux", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
    onPlatform("Win32");
    const host = await render(<Palette rows={rows()} request={(async () => ({ results: [] })) as never} rowName={() => "Oak"} onOpenMessage={noop} onClose={noop} />);
    const shown = hints(host, ".pal-hint");
    expect(shown["New conversation"]).toBe("Ctrl N");
    expect(shown["Quick ask"]).toBe("Ctrl Shift Space");
  });
});
