// @vitest-environment jsdom
// A greyed menu item that already passes its reason as `sub` keeps that one line. Menu must not draw the same words
// again as mi-why. aria-describedby names the line that is actually drawn.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Menu, type MenuItem } from "./Menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const describedBy = (el: Element | null | undefined) => {
  const id = el?.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent ?? undefined : undefined;
};

const row = (testid: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`);

const smalls = (el: Element | null | undefined) => [...(el?.querySelectorAll("small") ?? [])].map((s) => (s.textContent ?? "").replace(/\s+/g, " ").trim());

async function show(items: MenuItem[]) {
  await act(async () => root.render(<Menu at={{ x: 8, y: 8 }} label="More" onClose={() => undefined} items={items} />));
}

describe("a greyed menu item draws a matching reason only once", () => {
  it("keeps the sub-line when it matches the reason, and names that one line with aria-describedby", async () => {
    const why = "Oak is your default Trunk.";
    await show([
      { label: "Remove", run: () => undefined, disabled: why, sub: why, testid: "remove", danger: true },
    ]);
    const btn = row("remove")!;
    expect(btn.disabled).toBe(true);
    expect(smalls(btn)).toEqual([why]);
    expect(btn.querySelector(".mi-why")).toBeNull();
    expect(describedBy(btn)).toBe(why);
    const named = document.getElementById(btn.getAttribute("aria-describedby") ?? "");
    expect(named).toBe(btn.querySelector("small"));
    expect(named?.className).toBe("mi-s");
  });

  it("treats the same words as one line after trimming spaces and ignoring case", async () => {
    await show([
      { label: "Resume Birch", run: () => undefined, disabled: "Resuming a paused Trunk isn't available yet", sub: "  Resuming a paused Trunk isn't available yet  ", testid: "resume" },
    ]);
    const btn = row("resume")!;
    expect(smalls(btn)).toEqual(["Resuming a paused Trunk isn't available yet"]);
    expect(btn.querySelectorAll("small")).toHaveLength(1);
    expect(describedBy(btn)?.replace(/\s+/g, " ").trim().toLowerCase()).toBe("resuming a paused trunk isn't available yet");
  });

  it("keeps both lines when the sub-line and the reason are different words", async () => {
    await show([
      { label: "Remove", run: () => undefined, disabled: "Oak is your default Trunk.", sub: "This Trunk is in use.", testid: "remove" },
    ]);
    const btn = row("remove")!;
    expect(smalls(btn)).toEqual(["This Trunk is in use.", "Oak is your default Trunk."]);
    expect(btn.querySelector(".mi-why")?.textContent).toBe("Oak is your default Trunk.");
    expect(describedBy(btn)).toBe("Oak is your default Trunk.");
    expect(document.getElementById(btn.getAttribute("aria-describedby") ?? "")).toBe(btn.querySelector(".mi-why"));
  });

  it("still shows a reason with no sub-line, named by aria-describedby", async () => {
    await show([
      { label: "Remove Trunk…", run: () => undefined, disabled: "Oak is your default Trunk.", testid: "remove" },
    ]);
    const btn = row("remove")!;
    expect(smalls(btn)).toEqual(["Oak is your default Trunk."]);
    expect(describedBy(btn)).toBe("Oak is your default Trunk.");
    expect(document.getElementById(btn.getAttribute("aria-describedby") ?? "")).toBe(btn.querySelector(".mi-why"));
  });
});
