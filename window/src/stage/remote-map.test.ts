import { describe, expect, it } from "vitest";
import { clampView, contentRect, fittedRect, IDENTITY_VIEW, MAX_ZOOM, panBy, remoteSize, toClient, toRemote, zoomAt } from "./remote-map";

const box = { left: 100, top: 50, width: 800, height: 400 };

describe("mapping a point on the pane to the remote screen", () => {
  it("scales a picture that fills the box exactly", () => {
    const frame = { width: 1600, height: 800 };
    expect(toRemote({ x: 100, y: 50 }, box, frame, frame)).toEqual({ x: 0, y: 0 });
    expect(toRemote({ x: 500, y: 250 }, box, frame, frame)).toEqual({ x: 800, y: 400 });
    expect(toRemote({ x: 300, y: 150 }, box, frame, frame)).toEqual({ x: 400, y: 200 });
  });

  it("accounts for the remote device pixel ratio: a 2x frame maps to viewport CSS pixels", () => {
    const frame = { width: 1600, height: 800 };
    const remote = remoteSize(frame, 2);
    expect(remote).toEqual({ width: 800, height: 400 });
    expect(toRemote({ x: 500, y: 250 }, box, frame, remote)).toEqual({ x: 400, y: 200 });
    expect(toRemote({ x: 899, y: 449 }, box, frame, remote)).toEqual({ x: 799, y: 399 });
    // A nonsense ratio is treated as 1, never as a division by zero.
    expect(remoteSize(frame, 0)).toEqual(frame);
  });

  it("skips the letterbox bands of a tall picture and maps inside it", () => {
    const frame = { width: 400, height: 400 };
    // Fitted 400x400, centred: 200 px bands left and right.
    expect(fittedRect(box, frame)).toEqual({ left: 200, top: 0, width: 400, height: 400 });
    expect(toRemote({ x: 150, y: 250 }, box, frame, frame)).toBeNull();
    expect(toRemote({ x: 850, y: 250 }, box, frame, frame)).toBeNull();
    expect(toRemote({ x: 300, y: 50 }, box, frame, frame)).toEqual({ x: 0, y: 0 });
    expect(toRemote({ x: 500, y: 250 }, box, frame, frame)).toEqual({ x: 200, y: 200 });
  });

  it("skips the bands above and below a wide picture", () => {
    const frame = { width: 1600, height: 400 };
    // Fitted 800x200, centred: 100 px bands above and below.
    expect(contentRect(box, frame)).toEqual({ left: 100, top: 150, width: 800, height: 200 });
    expect(toRemote({ x: 500, y: 100 }, box, frame, frame)).toBeNull();
    expect(toRemote({ x: 500, y: 250 }, box, frame, frame)).toEqual({ x: 800, y: 200 });
  });

  it("follows the local zoom and pan", () => {
    const frame = { width: 800, height: 400 };
    const view = { zoom: 2, panX: -400, panY: -200 };
    // Zoomed 2x and panned to the middle: the box's centre shows the picture's centre…
    expect(toRemote({ x: 500, y: 250 }, box, frame, frame, view)).toEqual({ x: 400, y: 200 });
    // …and its top-left corner shows the picture's first quarter point.
    expect(toRemote({ x: 100, y: 50 }, box, frame, frame, view)).toEqual({ x: 200, y: 100 });
  });

  it("clamps to the edge pixel only when asked, and never one past the screen", () => {
    const frame = { width: 800, height: 400 };
    expect(toRemote({ x: 2000, y: -40 }, box, frame, frame)).toBeNull();
    expect(toRemote({ x: 2000, y: -40 }, box, frame, frame, IDENTITY_VIEW, true)).toEqual({ x: 799, y: 0 });
    expect(toRemote({ x: 900, y: 450 }, box, frame, frame)).toEqual({ x: 799, y: 399 });
  });

  it("refuses to map before there is a picture", () => {
    expect(toRemote({ x: 10, y: 10 }, box, { width: 0, height: 0 }, { width: 10, height: 10 })).toBeNull();
    expect(toRemote({ x: 10, y: 10 }, box, { width: 10, height: 10 }, { width: 0, height: 10 })).toBeNull();
  });

  it("finds where a remote pixel shows, for drawing the remote pointer", () => {
    const frame = { width: 1600, height: 800 };
    expect(toClient({ x: 799, y: 399 }, box, frame, { width: 1600, height: 800 })).toEqual({ x: 499.75, y: 249.75 });
  });
});

describe("the local zoom and pan", () => {
  it("zooms about the pinch centre, keeping what is under it in place", () => {
    const next = zoomAt(IDENTITY_VIEW, 2, { x: 500, y: 250 }, box);
    expect(next).toEqual({ zoom: 2, panX: -400, panY: -200 });
    const frame = { width: 800, height: 400 };
    expect(toRemote({ x: 500, y: 250 }, box, frame, frame, next)).toEqual(toRemote({ x: 500, y: 250 }, box, frame, frame));
  });

  it("never zooms out past the fitted picture or in past the limit", () => {
    expect(zoomAt(IDENTITY_VIEW, 0.5, { x: 500, y: 250 }, box)).toEqual(IDENTITY_VIEW);
    expect(zoomAt(IDENTITY_VIEW, 100, { x: 100, y: 50 }, box).zoom).toBe(MAX_ZOOM);
  });

  it("pans only within the zoomed picture", () => {
    const zoomed = { zoom: 2, panX: -400, panY: -200 };
    expect(panBy(zoomed, 1000, 1000, box)).toEqual({ zoom: 2, panX: 0, panY: 0 });
    expect(panBy(zoomed, -1000, -1000, box)).toEqual({ zoom: 2, panX: -800, panY: -400 });
    expect(panBy(IDENTITY_VIEW, 50, 50, box)).toEqual(IDENTITY_VIEW);
    expect(clampView({ zoom: Number.NaN, panX: 5, panY: Number.NaN }, box)).toEqual(IDENTITY_VIEW);
  });
});
