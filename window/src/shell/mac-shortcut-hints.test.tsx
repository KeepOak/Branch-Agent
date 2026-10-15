// UI audit N2: menus and Find anything showed "Ctrl N" and "Ctrl Shift Space" on a Mac. A Mac reads them with ⌘ ⌥ ⇧.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, type MenuItem } from "./Menu";
import { newMenuItems } from "./new-menu";
import { Palette } from "./Palette";
import { PersonMenu } from "./PersonMenu";

vi.mock("../rooms/NewGroupChat", () => ({ openNewGroupChat: () => {} }));

const noop = () => {};
const on = (platform: string) => vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
afterEach(() => vi.restoreAllMocks());

const newMenu = (): MenuItem[] => newMenuItems({ newWith: noop, trunks: [{ id: "main", name: "Juniper" }], defaultId: "main", newTrunk: noop, openPlace: noop, makeTrunk: noop, quickAsk: noop });
const hints = (html: string, cls: string) => [...html.matchAll(new RegExp(`class="${cls}">([^<]*)<`, "g"))].map((m) => m[1].trim()).filter(Boolean);
const menu = (items: MenuItem[]) => renderToStaticMarkup(<Menu at={{ x: 0, y: 0 }} items={items} onClose={noop} label="New" />);

describe("shortcut hints on a Mac", () => {
  it("the + new menu reads ⌘N and ⌘⇧Space, with no Ctrl", () => {
    on("MacIntel");
    const shown = hints(menu(newMenu()), "mi-hint");
    expect(shown).toContain("⌘N ›");
    expect(shown).toContain("⌘⇧Space");
    expect(shown).toContain("people, Trunks, agents");
    expect(shown.join(" ")).not.toMatch(/Ctrl/);
  });

  it("the person menu reads ⌘, for Settings", () => {
    on("MacIntel");
    const html = renderToStaticMarkup(<PersonMenu at={{ x: 0, y: 0 }} person="Sam" theme="light" onTheme={noop} onSettings={noop} onShortcuts={noop} onApps={noop} onAbout={noop} onClose={noop} onGuide={noop} onReplay={noop} onAddPerson={noop} onLock={noop} />);
    expect(hints(html, "mi-hint")).toContain("⌘,");
    expect(html).not.toMatch(/Ctrl/);
  });

  it("Find anything reads ⌘N for New conversation", () => {
    on("MacIntel");
    const html = renderToStaticMarkup(<Palette rows={[{ id: "a:new", group: "Actions", label: "New conversation", hint: "Ctrl N", run: noop }]} request={async () => ({}) as never} rowName={(k) => k} onOpenMessage={noop} onClose={noop} />);
    expect(hints(html, "pal-hint")).toEqual(["⌘N"]);
  });
});

describe("shortcut hints elsewhere", () => {
  it("Windows keeps Ctrl N and Ctrl Shift Space", () => {
    on("Win32");
    const shown = hints(menu(newMenu()), "mi-hint");
    expect(shown).toContain("Ctrl N ›");
    expect(shown).toContain("Ctrl Shift Space");
  });
});
