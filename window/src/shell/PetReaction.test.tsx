// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PetReactionArt } from "./PetReaction";
import { reactPet } from "./pet-reaction";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let intersection: (entries: { isIntersecting: boolean }[]) => void;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof intersection) { intersection = callback; }
    observe() { intersection([{ isIntersecting: true }]); }
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root.render(<button><PetReactionArt id="redpanda" still="/assets/art17/pets/redpanda.webp"><img alt="" /></PetReactionArt></button>));
});
afterEach(async () => {
  await act(async () => root.unmount()); document.body.replaceChildren();
  document.documentElement.removeAttribute("data-still"); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
it("loads one reaction on keyboard-compatible button activation and returns to a source-free still", async () => {
  expect(host.querySelector("video")).toBeNull();
  await act(async () => host.querySelector("button")!.click());
  const video = host.querySelector("video")!;
  expect(video.getAttribute("src")).toBe("/assets/art17/pets/redpanda-pat.webm");
  expect(video.style.visibility).toBe("hidden");
  await act(async () => video.dispatchEvent(new Event("playing")));
  expect(video.style.visibility).toBe("visible");
  await act(async () => vi.advanceTimersByTime(3000));
  expect(host.querySelector("video")).toBeNull();
});
it("ignores overlapping events and cancels as soon as the pet leaves view", async () => {
  await act(async () => reactPet("cheer"));
  await act(async () => reactPet("notice"));
  expect(host.querySelector("video")?.getAttribute("src")).toContain("-cheer.webm");
  await act(async () => intersection([{ isIntersecting: false }]));
  expect(host.querySelector("video")).toBeNull();
  await act(async () => reactPet("pat")); expect(host.querySelector("video")).toBeNull();
});
it("holds its still under Keep things still", async () => {
  document.documentElement.setAttribute("data-still", "");
  await act(async () => reactPet("cheer"));
  expect(host.querySelector("video")).toBeNull();
});
it("holds its still under reduced motion and on playback rejection", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches:true, addEventListener() {}, removeEventListener() {} }));
  await act(async () => reactPet("pat")); expect(host.querySelector("video")).toBeNull();
  vi.stubGlobal("matchMedia", () => ({ matches:false, addEventListener() {}, removeEventListener() {} }));
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error("not available"));
  await act(async () => reactPet("pat")); expect(host.querySelector("video")).toBeNull();
});
it("plays the pixel pose sequence once and returns to its original still", async () => {
  await act(async () => root.render(<button><PetReactionArt id="px-owl"><img alt="rest" /></PetReactionArt></button>));
  await act(async () => host.querySelector("button")!.click());
  expect(host.querySelector("video")).toBeNull();
  expect(host.querySelector("svg")).not.toBeNull();
  for (const ms of [300,120,195,105,120,360]) await act(async () => vi.advanceTimersByTime(ms));
  expect(host.querySelector("svg")).toBeNull();
  expect(host.querySelector("img")?.parentElement?.style.visibility).toBe("visible");
});
it("ignores a rejected play promise from a cancelled reaction", async () => {
  let reject: (reason: Error) => void = () => {};
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  await act(async () => reactPet("pat"));
  await act(async () => intersection([{ isIntersecting:false }]));
  await act(async () => intersection([{ isIntersecting:true }]));
  await act(async () => reactPet("cheer"));
  await act(async () => reject(new Error("cancelled earlier")));
  expect(host.querySelector("video")?.getAttribute("src")).toContain("-cheer.webm");
});
