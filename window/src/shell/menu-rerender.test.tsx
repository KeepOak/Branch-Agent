// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Menu, type MenuItem } from "./Menu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const items: MenuItem[] = [
  { kind: "sub", label: "New conversation", testid: "new-conversation", items: [{ label: "with Oak", run: () => {}, testid: "new-with-oak" }] },
  { label: "New Trunk", run: () => {}, testid: "new-trunk" },
];

/** The sidebar + the way WindowShell wires it: a second press on the opener closes the menu, and every render hands
 *  the menu a fresh onClose. `tick` stands for the shell re-rendering while the menu is open (a gateway event). */
function Plus({ tick }: { tick: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="new" data-tick={tick} onClick={() => setOpen((cur) => !cur)}>+</button>
      {open ? <Menu at={{ x: 0, y: 0 }} items={items} label="New" testid="new-menu" onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** A mouse press the way a browser delivers it: pointerdown, focus moves to the button, then click. */
async function press(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    el.focus();
    el.click();
  });
}

async function show(tick: number) {
  await act(async () => root!.render(<Plus tick={tick} />));
}

describe("sidebar + menu after a re-render (N1)", () => {
  it("one press on the + closes the menu after the shell re-renders with a submenu open", async () => {
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await show(0);
    await press(byId("new")!);
    expect(byId("new-menu")).not.toBeNull();
    await press(byId("new-conversation")!);
    expect(document.activeElement).toBe(byId("new-with-oak"));

    await show(1);
    // The re-render leaves focus in the submenu instead of pulling it back to the first row.
    expect(document.activeElement).toBe(byId("new-with-oak"));

    await press(byId("new")!);
    expect(byId("new-menu")).toBeNull();
    await press(byId("new")!);
    expect(byId("new-menu")).not.toBeNull();
  });

  it("a click outside still closes the menu with the latest onClose after a re-render", async () => {
    root = createRoot(document.body.appendChild(document.createElement("div")));
    const outside = document.body.appendChild(document.createElement("button"));
    await show(0);
    await press(byId("new")!);
    await show(1);
    await press(outside);
    expect(byId("new-menu")).toBeNull();
    await press(byId("new")!);
    expect(byId("new-menu")).not.toBeNull();
  });
});
