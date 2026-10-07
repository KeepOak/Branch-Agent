// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CharacterFace } from "./CharacterFace";
import { CAP, faceCap, PRIORITY } from "./cap";
import type { AgentState } from "./agentState";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
let intersect: (entries: { isIntersecting:boolean }[]) => void;
const holders: number[] = [];
const appearance = { still:"/still.webp", states:{ yay:"/yay.webm", wait:"/wait.webm", work:"/work.webm" } };
async function render(state: AgentState, priority: number = PRIORITY.row) {
  await act(async () => root.render(<CharacterFace appearance={appearance} size={42} state={state} priority={priority} />));
}
beforeEach(async () => {
  vi.spyOn(HTMLMediaElement.prototype,"pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype,"load").mockImplementation(() => {});
  vi.spyOn(document,"hidden","get").mockReturnValue(false);
  vi.stubGlobal("matchMedia", () => ({ matches:false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: typeof intersect) { intersect = callback; } observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await render("yay"); await act(async () => intersect([{ isIntersecting:true }]));
});
afterEach(async () => { await act(async () => root.unmount()); holders.splice(0).forEach(id => faceCap.release(id)); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("does not replay a completed arrival when visibility or priority changes", async () => {
  const video = host.querySelector("video")!;
  expect(video.loop).toBe(false);
  await act(async () => video.dispatchEvent(new Event("playing")));
  await act(async () => video.dispatchEvent(new Event("ended")));
  expect(host.querySelector("video")).toBeNull();
  await act(async () => intersect([{ isIntersecting:false }]));
  await act(async () => intersect([{ isIntersecting:true }]));
  expect(host.querySelector("video")).toBeNull();
  await render("yay", PRIORITY.open); expect(host.querySelector("video")).toBeNull();
});
it("settles an interrupted arrival but still resumes live work and permits the next arrival", async () => {
  await act(async () => host.querySelector("video")!.dispatchEvent(new Event("playing")));
  await act(async () => intersect([{ isIntersecting:false }]));
  await act(async () => intersect([{ isIntersecting:true }]));
  expect(host.querySelector("video")).toBeNull();
  await render("work"); expect(host.querySelector("video")?.loop).toBe(true);
  await act(async () => intersect([{ isIntersecting:false }]));
  await act(async () => intersect([{ isIntersecting:true }])); expect(host.querySelector("video")?.loop).toBe(true);
  await render("yay"); expect(host.querySelector("video")).not.toBeNull(); expect(host.querySelector("video")?.loop).toBe(false);
});
it("does not restart an arrival after the native cap revokes its slot", async () => {
  await act(async () => host.querySelector("video")!.dispatchEvent(new Event("playing")));
  for (let index = 1; index < CAP.video; index++) {
    const id = 8000 + index; holders.push(id);
    expect(faceCap.request(id,"video",PRIORITY.row,() => {})).toBe(true);
  }
  holders.push(9000);
  await act(async () => { expect(faceCap.request(9000,"video",PRIORITY.open,() => {})).toBe(true); });
  expect(host.querySelector("video")).toBeNull();
  await render("yay",PRIORITY.open); expect(host.querySelector("video")).toBeNull();
  await render("work",PRIORITY.open); expect(host.querySelector("video")?.loop).toBe(true);
});
it("keeps the current one-shot playing when its native priority changes", async () => {
  const clip = host.querySelector("video")!;
  await act(async () => clip.dispatchEvent(new Event("playing")));
  await render("yay",PRIORITY.open);
  expect(host.querySelector("video")).toBe(clip);
  expect(clip.getAttribute("src")).toBe("/yay.webm");
  expect(clip.pause).not.toHaveBeenCalled();
  await act(async () => clip.dispatchEvent(new Event("ended")));
  await render("yay",PRIORITY.row); expect(host.querySelector("video")).toBeNull();
});
