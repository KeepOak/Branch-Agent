// @vitest-environment jsdom
import { act, StrictMode, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../shell/Dialog";
import { Popover } from "../shell/Popover";
import { Menu } from "../shell/Menu";
import { QuickAsk } from "../shell/QuickAsk";
import { Dialog as ThreadDialog, Popover as ThreadPopover } from "../thread/Dialog";
import { Popover as ComposerPopover } from "../composer/Popover";
import { PhotoDialog, PictureDialog } from "../composer/PhotoDialog";
import { FilterSortPopover } from "../shell/FilterSort";
import { DEFAULT_PREFS } from "../shell/list-model";
import { Palette } from "../shell/Palette";
import { ThreadColumn } from "../shell/ThreadColumn";
import { PictureViewer } from "../thread/PictureViewer";
import { useOverlayFocus } from "./useOverlayFocus";

vi.mock("../face/Face", () => ({ Face: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
async function render(node: ReactNode) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(node));
}
async function key(key: string, shiftKey = false, target: EventTarget = document.activeElement!) {
  await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })));
}
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function opener() {
  const button = document.body.appendChild(document.createElement("button"));
  button.textContent = "Open";
  button.focus();
  return button;
}

describe("shared overlay keyboard lifecycle", () => {
  it.each(["shell", "thread", "popover", "thread-popover", "composer", "photo", "picture", "quick-ask"])("closes %s with Escape and restores the opener, including autoFocus children", async (kind) => {
    const trigger = opener();
    function Example() {
      const [open, setOpen] = useState(true);
      const anchor = useRef<HTMLElement>(trigger);
      const close = () => setOpen(false);
      if (!open) return null;
      const child = <input autoFocus aria-label="Name" />;
      if (kind === "shell") return <Dialog title="Edit" onClose={close}>{child}</Dialog>;
      if (kind === "thread") return <ThreadDialog title="Edit" onClose={close} footer={null}>{child}</ThreadDialog>;
      if (kind === "popover") return <Popover at={{ x: 0, y: 0 }} label="Person" onClose={close}><p>No people</p></Popover>;
      if (kind === "thread-popover") return <ThreadPopover label="Actions" onClose={close} anchor={trigger}>{child}</ThreadPopover>;
      if (kind === "composer") return <ComposerPopover label="Attach" onClose={close} anchor={anchor}>{child}</ComposerPopover>;
      if (kind === "photo") return <PhotoDialog onClose={close} onUse={() => {}} onUpload={() => {}} />;
      if (kind === "picture") return <PictureDialog onClose={close} onMake={() => {}} />;
      return <QuickAsk trunks={[]} defaultId={null} onSend={() => {}} onClose={close} />;
    }
    await render(<StrictMode><Example /></StrictMode>);
    expect(document.activeElement).not.toBe(trigger);
    await key("Escape");
    expect(document.querySelector('[role="dialog"], [role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Quick ask from its last button and its first input", async () => {
    opener();
    await render(<QuickAsk trunks={[]} defaultId={null} onSend={() => {}} onClose={() => {}} />);
    const first = document.querySelector("input")!;
    const last = document.querySelector('[data-testid="quick-ask-start"]') as HTMLElement;
    await key("Tab", true);
    expect(document.activeElement).toBe(last);
    await key("Tab");
    expect(document.activeElement).toBe(first);
  });

  it("skips hidden, disabled and negative-tabindex controls and contains stray focus", async () => {
    const trigger = opener();
    await render(<Dialog title="Edit" onClose={() => {}}><button disabled>Disabled</button><button hidden>Hidden</button><button tabIndex={-1}>Programmatic</button><a href="#end">End</a></Dialog>);
    const first = document.querySelector('[aria-label="Close"]') as HTMLElement;
    const last = document.querySelector("a")!;
    first.focus();
    await key("Tab", true);
    expect(document.activeElement).toBe(last);
    await key("Tab");
    expect(document.activeElement).toBe(first);
    trigger.focus();
    expect(document.activeElement).toBe(first);
  });

  it("gives an empty modal a focus target and contains both Tab directions", async () => {
    opener();
    function Empty() {
      const ref = useRef<HTMLDivElement>(null);
      useOverlayFocus(ref, () => {}, { modal: true });
      return <div ref={ref} role="dialog" tabIndex={-1} />;
    }
    await render(<Empty />);
    const panel = document.querySelector('[role="dialog"]');
    expect(document.activeElement).toBe(panel);
    await key("Tab");
    expect(document.activeElement).toBe(panel);
    await key("Tab", true);
    expect(document.activeElement).toBe(panel);
  });

  it("closes only the topmost layer and restores the nested trigger", async () => {
    const trigger = opener();
    function Nested() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(false);
      return outer ? <Dialog title="Outer" onClose={() => setOuter(false)}><button onClick={() => setInner(true)}>Inner</button>{inner ? <Dialog title="Inner" onClose={() => setInner(false)}><input autoFocus /></Dialog> : null}</Dialog> : null;
    }
    await render(<Nested />);
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Inner")!;
    button.focus();
    await act(async () => button.click());
    await key("Escape");
    expect(document.querySelector('[aria-label="Inner"]')).toBeNull();
    expect(document.querySelector('[aria-label="Outer"]')).not.toBeNull();
    expect(document.activeElement).toBe(button);
    await key("Escape");
    expect(document.activeElement).toBe(trigger);
  });

  it("restores a surviving trigger when a nested action removes both overlays", async () => {
    const trigger = opener();
    function Nested() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(false);
      return outer ? <Dialog title="Outer" onClose={() => setOuter(false)}><button onClick={() => setInner(true)}>Inner</button>{inner ? <Dialog title="Inner" onClose={() => setInner(false)}><button onClick={() => setOuter(false)}>Done</button></Dialog> : null}</Dialog> : null;
    }
    await render(<Nested />);
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Inner")!;
    button.focus();
    await act(async () => button.click());
    const done = [...document.querySelectorAll("button")].find((b) => b.textContent === "Done")!;
    done.focus();
    await act(async () => done.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("returns through a removed launching menu to its surviving trigger", async () => {
    const trigger = opener();
    function Chain() {
      const [view, setView] = useState("menu");
      return view === "menu" ? <Menu at={{ x: 0, y: 0 }} label="New" onClose={() => setView("")} items={[{ label: "Start the group chat", run: () => setView("dialog") }]} /> : view === "dialog" ? <Dialog title="Group chat" onClose={() => setView("")}><input autoFocus /></Dialog> : null;
    }
    await render(<Chain />);
    await act(async () => (document.activeElement as HTMLElement).click());
    expect(document.querySelector('[aria-label="Group chat"]')).not.toBeNull();
    await key("Escape");
    expect(document.activeElement).toBe(trigger);
  });

  it("uses the latest close callback without resetting focus on a re-render", async () => {
    opener();
    const first = vi.fn(), latest = vi.fn();
    const panel = (close: () => void) => <ThreadDialog title="Edit" onClose={close} footer={null}><input /><textarea /></ThreadDialog>;
    await render(panel(first));
    const text = document.querySelector("textarea")!;
    text.focus();
    await act(async () => root.render(panel(latest)));
    expect(document.activeElement).toBe(text);
    await key("Escape", false, document.body);
    expect(latest).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});

describe("inner handlers and keyboard edge cases", () => {
  it("lets Escape in Find a person clear the search before it closes Filter and sort", async () => {
    opener();
    const closed = vi.fn();
    const facts = { trunks: [], people: { selfId: null, names: new Map([["ada", "Ada"], ["oak", "Oak"]]) }, owners: 0, folders: false, level: "advanced" as const, unreadTrunks: new Set<string>() };
    function Example() {
      const [open, setOpen] = useState(true);
      return open ? <FilterSortPopover at={{ x: 0, y: 0 }} prefs={DEFAULT_PREFS} facts={facts} onChange={() => {}} onClose={() => (closed(), setOpen(false))} onSettings={() => {}} /> : null;
    }
    await render(<Example />);
    const people = document.querySelector('[data-page="people"]') as HTMLElement;
    await act(async () => people.click());
    const search = document.querySelector('[aria-label="Find a person"]') as HTMLInputElement;
    search.focus();
    await act(async () => type(search, "Ad"));
    expect(search.value).toBe("Ad");
    await key("Escape", false, search);
    expect(search.value).toBe("");
    expect(closed).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="filter-popover"]')).not.toBeNull();
    await key("Escape", false, search);
    expect(closed).toHaveBeenCalledOnce();
  });

  it("lets an inner React handler that prevents Escape keep the dialog open", async () => {
    opener();
    const close = vi.fn();
    await render(<Dialog title="Edit" onClose={close}><input autoFocus aria-label="Name" onKeyDown={(e) => e.key === "Escape" && e.preventDefault()} /></Dialog>);
    await key("Escape");
    expect(close).not.toHaveBeenCalled();
  });

  it("keeps a window capture handler that stops Escape (the held scene preview) ahead of the overlay", async () => {
    opener();
    const close = vi.fn();
    const held = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); } };
    window.addEventListener("keydown", held, true);
    await render(<Dialog title="Edit" onClose={close}><input autoFocus /></Dialog>);
    await key("Escape");
    window.removeEventListener("keydown", held, true);
    expect(close).not.toHaveBeenCalled();
  });

  it("ignores Escape during IME composition, including Safari's keyCode 229 commit", async () => {
    opener();
    const close = vi.fn();
    await render(<Dialog title="Edit" onClose={close}><input autoFocus /></Dialog>);
    const target = document.activeElement!;
    await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true })));
    await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true, cancelable: true })));
    expect(close).not.toHaveBeenCalled();
    await key("Escape");
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not trap Tab in a nonmodal popover", async () => {
    opener();
    await render(<Popover at={{ x: 0, y: 0 }} label="Person" onClose={() => {}}><button>One</button><button>Two</button></Popover>);
    const two = [...document.querySelectorAll("button")].find((b) => b.textContent === "Two")!;
    two.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => two.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(two);
  });

  it("still closes a popover on a click outside", async () => {
    opener();
    const close = vi.fn();
    const outside = document.body.appendChild(document.createElement("p"));
    await render(<Popover at={{ x: 0, y: 0 }} label="Person" onClose={close}><button>One</button></Popover>);
    await act(async () => outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(close).toHaveBeenCalledOnce();
  });

  it("cycles Tab through contenteditable fields in a modal", async () => {
    opener();
    await render(<Dialog title="Edit" onClose={() => {}}><div contentEditable suppressContentEditableWarning aria-label="Note">x</div></Dialog>);
    const close = document.querySelector('[aria-label="Close"]') as HTMLElement;
    const note = document.querySelector('[aria-label="Note"]') as HTMLElement;
    close.focus();
    await key("Tab", true);
    expect(document.activeElement).toBe(note);
    await key("Tab");
    expect(document.activeElement).toBe(close);
  });

  it("closes How threads show with Escape or a click outside and returns to its button", async () => {
    await render(<ThreadColumn name="Oak" generalKey="agent:oak:main" openKey={null} items={[]} onOpen={() => {}} />);
    const button = document.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;
    button.focus();
    await act(async () => button.click());
    const menu = document.querySelector('[aria-label="Threads show as"]')!;
    expect(menu.contains(document.activeElement)).toBe(true);
    await key("Escape");
    expect(document.querySelector('[aria-label="Threads show as"]')).toBeNull();
    expect(document.activeElement).toBe(button);
    await act(async () => button.click());
    await act(async () => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(document.querySelector('[aria-label="Threads show as"]')).toBeNull();
  });

  it.each(["palette", "picture-viewer"])("closes %s with Escape and restores its opener", async (kind) => {
    const trigger = opener();
    function Example() {
      const [open, setOpen] = useState(true);
      if (!open) return null;
      return kind === "palette"
        ? <Palette rows={[]} request={(async () => ({})) as never} rowName={() => ""} onOpenMessage={() => {}} onClose={() => setOpen(false)} />
        : <PictureViewer items={[{ name: "cat.png", src: "data:image/png;base64,AA==" } as never]} start={0} onClose={() => setOpen(false)} />;
    }
    await render(<Example />);
    expect(document.activeElement).not.toBe(trigger);
    await key("Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
