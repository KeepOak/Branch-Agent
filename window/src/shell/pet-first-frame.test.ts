// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { watchPetFrame } from "./pet-first-frame";
it("waits for a presented frame even if playback events arrive sooner", () => {
  const video = document.createElement("video"), show = vi.fn(), cancel = vi.fn();
  let firstFrame: () => void = () => {};
  video.requestVideoFrameCallback = vi.fn(callback => { firstFrame = () => callback(0, {} as VideoFrameCallbackMetadata); return 4; });
  video.cancelVideoFrameCallback = cancel;
  const stop = watchPetFrame(video, show);
  video.dispatchEvent(new Event("playing")); expect(show).not.toHaveBeenCalled();
  firstFrame(); expect(show).toHaveBeenCalledOnce();
  stop(); expect(cancel).toHaveBeenCalledWith(4);
});
it("ignores a decoded frame arriving after reaction cancellation", () => {
  const video = document.createElement("video"), show = vi.fn();
  let firstFrame: () => void = () => {};
  video.requestVideoFrameCallback = vi.fn(callback => { firstFrame = () => callback(0, {} as VideoFrameCallbackMetadata); return 7; });
  video.cancelVideoFrameCallback = vi.fn();
  const stop = watchPetFrame(video, show); stop(); firstFrame();
  expect(show).not.toHaveBeenCalled();
});
it("falls back to decoded data on browsers without frame callbacks and removes listeners", () => {
  const video = document.createElement("video"), show = vi.fn();
  Object.defineProperty(video, "readyState", { configurable:true, value:1 });
  const stop = watchPetFrame(video, show);
  video.dispatchEvent(new Event("playing")); expect(show).not.toHaveBeenCalled();
  Object.defineProperty(video, "readyState", { configurable:true, value:2 });
  video.dispatchEvent(new Event("loadeddata")); expect(show).toHaveBeenCalledOnce();
  stop(); video.dispatchEvent(new Event("playing")); expect(show).toHaveBeenCalledOnce();
});
