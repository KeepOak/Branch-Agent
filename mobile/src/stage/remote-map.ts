// Copied from window/src/stage/remote-map.ts.
// Pure geometry for driving a remote screen from its picture in a pane.
//
// The pane shows a picture (the browser's screencast frame, or the computer's screenshot) fitted inside a box the way
// `object-fit: contain` fits it: scaled to the box's shorter side and centred, with bands on the other sides. The person
// can also zoom and pan the picture locally (pinch on a touch screen); that view transform is
// `translate(panX, panY) scale(zoom)` with its origin at the box's top left. A point on screen therefore goes:
//   client point -> undo the local view -> undo the contain fit -> a fraction of the picture -> remote pixels.
// The picture's own pixel size and the remote coordinate space differ when the remote has a device pixel ratio other
// than 1 (a 2x browser frame is twice the viewport's CSS pixels); remote pixels are what the input route expects.

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
/** The local zoom and pan applied to the picture inside its box. zoom 1 and pan 0 is the picture as fitted. */
export type View = { zoom: number; panX: number; panY: number };
export type Point = { x: number; y: number };

export const IDENTITY_VIEW: View = { zoom: 1, panX: 0, panY: 0 };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

const finite = (n: number) => Number.isFinite(n);
const usable = (s: Size | null | undefined): s is Size => Boolean(s && finite(s.width) && finite(s.height) && s.width > 0 && s.height > 0);

/** The remote coordinate space for a picture taken at `dpr` device pixels per remote pixel. */
export function remoteSize(frame: Size, dpr = 1): Size {
  const ratio = finite(dpr) && dpr > 0 ? dpr : 1;
  return { width: frame.width / ratio, height: frame.height / ratio };
}

/** Where the fitted picture sits inside the box, before the local view: box-relative CSS pixels. */
export function fittedRect(box: Size, frame: Size): Rect | null {
  if (!usable(box) || !usable(frame)) return null;
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  const width = frame.width * scale, height = frame.height * scale;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}

/** Where the picture is on screen, in client pixels, with the local view applied. */
export function contentRect(box: Rect, frame: Size, view: View = IDENTITY_VIEW): Rect | null {
  const fit = fittedRect(box, frame);
  if (!fit) return null;
  return {
    left: box.left + view.panX + fit.left * view.zoom,
    top: box.top + view.panY + fit.top * view.zoom,
    width: fit.width * view.zoom,
    height: fit.height * view.zoom,
  };
}

/**
 * The remote pixel under a client point. Outside the picture (the letterbox bands, or past an edge) it is null,
 * unless `clamp` is set: then the nearest edge pixel is used, which a trackpad cursor wants.
 */
export function toRemote(point: Point, box: Rect, frame: Size, remote: Size, view: View = IDENTITY_VIEW, clamp = false): Point | null {
  const rect = contentRect(box, frame, view);
  if (!rect || !usable(remote)) return null;
  let fx = (point.x - rect.left) / rect.width, fy = (point.y - rect.top) / rect.height;
  if (!finite(fx) || !finite(fy)) return null;
  if (fx < 0 || fy < 0 || fx > 1 || fy > 1) {
    if (!clamp) return null;
    fx = Math.min(1, Math.max(0, fx));
    fy = Math.min(1, Math.max(0, fy));
  }
  // The last pixel is width - 1: a point on the far edge must not land one past the screen.
  const x = Math.min(Math.max(0, Math.ceil(remote.width) - 1), Math.floor(fx * remote.width));
  const y = Math.min(Math.max(0, Math.ceil(remote.height) - 1), Math.floor(fy * remote.height));
  return { x, y };
}

/** The client point that shows a remote pixel (its centre): where to draw the remote cursor. */
export function toClient(point: Point, box: Rect, frame: Size, remote: Size, view: View = IDENTITY_VIEW): Point | null {
  const rect = contentRect(box, frame, view);
  if (!rect || !usable(remote)) return null;
  return { x: rect.left + ((point.x + 0.5) / remote.width) * rect.width, y: rect.top + ((point.y + 0.5) / remote.height) * rect.height };
}

/** Keeps the zoom in range and the zoomed picture covering the box, so panning never shows past the picture's box. */
export function clampView(view: View, box: Size): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, finite(view.zoom) ? view.zoom : 1));
  const minX = box.width - box.width * zoom, minY = box.height - box.height * zoom;
  const panX = Math.min(0, Math.max(minX, finite(view.panX) ? view.panX : 0));
  const panY = Math.min(0, Math.max(minY, finite(view.panY) ? view.panY : 0));
  return { zoom, panX: panX === 0 ? 0 : panX, panY: panY === 0 ? 0 : panY };
}

/** Zooms by `factor` about a client point, keeping what is under that point in place, then clamps. */
export function zoomAt(view: View, factor: number, at: Point, box: Rect): View {
  if (!finite(factor) || factor <= 0) return view;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const localX = (at.x - box.left - view.panX) / view.zoom, localY = (at.y - box.top - view.panY) / view.zoom;
  return clampView({ zoom, panX: at.x - box.left - localX * zoom, panY: at.y - box.top - localY * zoom }, box);
}

/** Pans the zoomed picture by a client delta, then clamps. */
export function panBy(view: View, dx: number, dy: number, box: Size): View {
  return clampView({ zoom: view.zoom, panX: view.panX + dx, panY: view.panY + dy }, box);
}
