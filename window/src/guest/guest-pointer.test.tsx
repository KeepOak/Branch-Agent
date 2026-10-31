// @vitest-environment jsdom
// Clicks and touch in Your browser must land on the page that is showing. jsdom does no layout, so this test resolves the
// pane's own stylesheet (guest.css) for the boxes stacked in the page area and asks, at the area's centre and corners, which
// box is on top and takes the pointer, the way elementFromPoint would. It must be the showing tab's webview.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GuestBrowser } from "./GuestBrowser";
import { createGuestAccess } from "./guest-access";
import type { GuestEngine } from "./guest-host";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CSS = readFileSync(resolve(__dirname, "guest.css"), "utf8");
/** The page area's size for the hit test; any size shows the same stacking. */
const AREA = { w: 1000, h: 600 };
const engine: GuestEngine = { request: async () => ({}) as never, onEvent: () => () => undefined };

let root: Root | undefined;
let container: HTMLDivElement;
let style: HTMLStyleElement;

beforeEach(() => {
  style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  style.remove();
});

type Decls = Map<string, string>;

function specificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (selector.replace(/\[[^\]]+\]|[.#:][\w-]+/g, " ").match(/[a-z][\w-]*/gi) ?? []).length;
  return ids * 10000 + classes * 100 + types;
}

/** The declarations guest.css gives an element, in cascade order (specificity, then source order). Shorthand inset is expanded. */
function cascade(el: Element): Decls {
  const hits: Array<{ spec: number; order: number; rule: CSSStyleRule }> = [];
  [...style.sheet!.cssRules].forEach((rule, order) => {
    if (!(rule instanceof CSSStyleRule)) return;
    const matching = rule.selectorText.split(",").map((s) => s.trim()).filter((s) => !s.includes("::") && el.matches(s));
    if (matching.length) hits.push({ spec: Math.max(...matching.map(specificity)), order, rule });
  });
  hits.sort((a, b) => a.spec - b.spec || a.order - b.order);
  const out: Decls = new Map();
  for (const { rule } of hits) {
    for (let i = 0; i < rule.style.length; i += 1) {
      const name = rule.style[i];
      const value = rule.style.getPropertyValue(name).trim();
      if (name === "inset") {
        const v = value.split(/\s+/);
        const [t, r = t, b = t, l = r] = v;
        out.set("top", t).set("right", r).set("bottom", b).set("left", l);
      } else out.set(name, value);
    }
  }
  return out;
}

function length(value: string | undefined, of: number): number | null {
  if (!value || value === "auto") return null;
  if (value.endsWith("%")) return (parseFloat(value) / 100) * of;
  return parseFloat(value);
}

/** One axis of an absolutely positioned box inside the page area. */
function axis(start: number | null, end: number | null, size: number | null, of: number): [number, number] {
  if (start !== null && size !== null) return [start, start + size];
  if (start !== null && end !== null) return [start, of - end];
  if (end !== null && size !== null) return [of - end - size, of - end];
  if (start !== null) return [start, of];
  return [0, size ?? of];
}

type Box = { el: Element; x: [number, number]; y: [number, number]; z: number; takesPointer: boolean };

function boxOf(el: Element): Box {
  const d = cascade(el);
  const positioned = d.get("position") === "absolute" || d.get("position") === "fixed";
  const x = positioned ? axis(length(d.get("left"), AREA.w), length(d.get("right"), AREA.w), length(d.get("width"), AREA.w), AREA.w) : ([0, AREA.w] as [number, number]);
  const y = positioned ? axis(length(d.get("top"), AREA.h), length(d.get("bottom"), AREA.h), length(d.get("height"), AREA.h), AREA.h) : ([0, AREA.h] as [number, number]);
  const takesPointer = d.get("pointer-events") !== "none" && d.get("visibility") !== "hidden" && d.get("display") !== "none";
  return { el, x, y, z: Number.parseInt(d.get("z-index") ?? "0", 10) || 0, takesPointer };
}

/** What a click at (x, y) in the page area lands on: the top box there that takes the pointer. */
function topAt(stage: Element, x: number, y: number): Element | null {
  const boxes = [...stage.children].map(boxOf).filter((b) => b.takesPointer && x >= b.x[0] && x < b.x[1] && y >= b.y[0] && y < b.y[1]);
  // Later siblings paint above earlier ones at the same z-index.
  const top = boxes.reduce<Box | null>((best, b) => (best === null || b.z >= best.z ? b : best), null);
  return top?.el ?? null;
}

const SAMPLES: Array<[string, number, number]> = [
  ["centre", AREA.w / 2, AREA.h / 2],
  ["top left", 4, 4],
  ["top right", AREA.w - 4, 4],
  ["bottom left", 4, AREA.h - 4],
  ["bottom right", AREA.w - 4, AREA.h - 4],
];

const find = <T extends Element>(selector: string) => container.querySelector<T>(selector);
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text || b.getAttribute("aria-label") === text) as HTMLButtonElement;
const click = async (el: HTMLElement) => act(async () => el.click());

describe("clicks and touch in Your browser", () => {
  it("land on the showing page when another tab is open behind it", async () => {
    await act(async () => root!.render(<GuestBrowser bridge={null} startUrl="https://a.example/" />));
    // The chrome still takes clicks: + opens a second tab and the first tab's name brings the first page back.
    await click(button("New tab"));
    expect(container.querySelectorAll(".guest-tab")).toHaveLength(2);
    await click(container.querySelector<HTMLButtonElement>(".guest-tabname")!);
    const [first, second] = [...container.querySelectorAll(".guest-tab")];
    expect(first.getAttribute("data-active")).toBe("true");
    expect(second.getAttribute("data-active")).toBe("false");

    const stage = find(".guest-stage")!;
    for (const [where, x, y] of SAMPLES) {
      const top = topAt(stage, x, y);
      expect(top, `a click at the page's ${where} lands on the showing tab`).toBe(first);
      expect(top?.querySelector("webview")).toBe(first.querySelector("webview"));
    }
  });

  it("keep the page area free of pointer blockers", async () => {
    await act(async () => root!.render(<GuestBrowser bridge={null} startUrl="https://a.example/" />));
    const chain = [find(".guest-pane")!, find(".guest-stage")!, find('.guest-tab[data-active="true"]')!, find("webview")!];
    for (const el of chain) {
      const d = cascade(el);
      expect(d.get("pointer-events") ?? "auto", el.className).not.toBe("none");
      expect(d.get("touch-action") ?? "auto", el.className).not.toBe("none");
      expect(d.get("-webkit-app-region") ?? "none", el.className).not.toBe("drag");
    }
    expect(CSS).not.toMatch(/app-region\s*:\s*drag/);
  });

  it("still go to the question about first use while it is asked, and its buttons work", async () => {
    const access = createGuestAccess();
    await act(async () => root!.render(<GuestBrowser bridge={null} engine={engine} sessionKey="agent:main:one" access={access} startUrl="https://a.example/" />));
    await act(async () => access.ask("agent:main:one"));
    const scrim = find(".guest-consent-scrim")!;
    const pane = find(".guest-pane")!;
    expect(topAt(pane, AREA.w / 2, AREA.h / 2)).toBe(scrim);
    await click(button("Allow"));
    expect(access.state("agent:main:one")).toEqual({ access: "allowed", asking: false });
    expect(find(".guest-consent-scrim")).toBeNull();
  });
});
