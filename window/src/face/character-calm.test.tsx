// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CharacterFace } from "./CharacterFace";
import { faceCap } from "./cap";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, hidden = false;
let intersect: (entries: { isIntersecting:boolean }[]) => void;
beforeEach(async () => {
  hidden = false;
  vi.spyOn(HTMLMediaElement.prototype,"pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype,"load").mockImplementation(() => {});
  vi.spyOn(document,"hidden","get").mockImplementation(() => hidden);
  vi.stubGlobal("matchMedia", () => ({ matches:false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: typeof intersect) { intersect = callback; } observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root.render(<CharacterFace appearance={{ still:"/still.webp", states:{ work:"/work.webm" } }} size={42} state="work" />));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); document.documentElement.removeAttribute("data-still"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("does not acquire a video slot before visible intersection, and releases it on hide", async () => {
  expect(host.querySelector("video")).toBeNull(); expect(faceCap.playing("video")).toBe(0);
  await act(async () => intersect([{ isIntersecting:true }]));
  expect(host.querySelector("video")?.loop).toBe(true); expect(faceCap.playing("video")).toBe(1);
  const previous = host.querySelector("video")!;
  hidden = true; await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(host.querySelector("video")).toBeNull(); expect(faceCap.playing("video")).toBe(0);
  expect(previous.getAttribute("src")).toBeNull(); expect(previous.pause).toHaveBeenCalled(); expect(previous.load).toHaveBeenCalled();
  hidden = false; await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(host.querySelector("video")).not.toBeNull();
});
it("restores the still and releases the native cap when Keep things still is switched on", async () => {
  await act(async () => intersect([{ isIntersecting:true }]));
  await act(async () => document.documentElement.setAttribute("data-still",""));
  expect(host.querySelector("video")).toBeNull(); expect(host.querySelector("img")?.src).toContain("/still.webp");
  expect(faceCap.playing("video")).toBe(0);
});
