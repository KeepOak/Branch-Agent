// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCharacterMotion } from "./use-character-motion";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
let intersect: (entries: { isIntersecting:boolean }[]) => void;
let hidden = false, reduced = false, mediaChange: () => void;
function Fixture() { const box = useRef<HTMLDivElement>(null), allowed = useCharacterMotion(box); return <div ref={box} data-motion={String(allowed)} />; }
beforeEach(async () => {
  hidden = false; reduced = false;
  vi.spyOn(document,"hidden","get").mockImplementation(() => hidden);
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener:(_: string, listener: () => void) => { mediaChange = listener; }, removeEventListener() {} }));
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: typeof intersect) { intersect = callback; } observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); document.documentElement.removeAttribute("data-still"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const allowed = () => host.querySelector("[data-motion]")?.getAttribute("data-motion");
it("holds offscreen and unknown intersections still, allowing only observed visible characters", async () => {
  expect(allowed()).toBe("false");
  await act(async () => intersect([{ isIntersecting:true }])); expect(allowed()).toBe("true");
  await act(async () => intersect([{ isIntersecting:false }])); expect(allowed()).toBe("false");
});
it("cancels immediately under hidden, reduced-motion and Keep things still gates", async () => {
  await act(async () => intersect([{ isIntersecting:true }]));
  hidden = true; await act(async () => document.dispatchEvent(new Event("visibilitychange"))); expect(allowed()).toBe("false");
  hidden = false; await act(async () => document.dispatchEvent(new Event("visibilitychange"))); expect(allowed()).toBe("true");
  reduced = true; await act(async () => mediaChange()); expect(allowed()).toBe("false");
  reduced = false; await act(async () => mediaChange());
  await act(async () => document.documentElement.setAttribute("data-still","")); expect(allowed()).toBe("false");
});
