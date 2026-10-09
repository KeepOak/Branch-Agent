import { isRecord } from "@branch/normalization-core/record-coerce";

/**
 * Wire limits and frame shape for the Watch screen stream. Frames ride the existing graft gateway connection
 * (no new listening port). One frame is in flight at a time: the watcher pulls, the watched side answers with
 * the next frame, so a slow link slows the frame rate instead of queueing memory.
 */
export const SCREEN_WATCH_MAX_FRAME_BASE64_CHARS = 1_048_576;
/** Longest a pull waits for a newer frame before it returns empty and the watcher pulls again. */
export const SCREEN_WATCH_PULL_WAIT_MS = 1_000;
/** A watch with no pull or push for this long ends on its own, and the indicator clears. */
export const SCREEN_WATCH_STALE_MS = 5_000;
/** 10 fps at the fast end, 2 fps at the slow end. */
export const SCREEN_WATCH_MIN_INTERVAL_MS = 100;
export const SCREEN_WATCH_MAX_INTERVAL_MS = 500;

const MAX_DIMENSION = 8192;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export type ScreenWatchFrame = {
  mime: "image/jpeg" | "image/webp";
  /** Base64 image bytes, already downscaled by the watched side. */
  data: string;
  width: number;
  height: number;
  capturedAtMs: number;
};

const isDimension = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION;

const isTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Validates a frame pushed over the link. Anything off-shape is refused, never coerced. */
export function parseScreenWatchFrame(value: unknown): ScreenWatchFrame {
  if (!isRecord(value)) {
    throw new Error("invalid screen frame");
  }
  const { mime, data, width, height, capturedAtMs } = value;
  const validMime = mime === "image/jpeg" || mime === "image/webp";
  const validData =
    typeof data === "string" &&
    data.length > 0 &&
    data.length <= SCREEN_WATCH_MAX_FRAME_BASE64_CHARS &&
    BASE64_PATTERN.test(data);
  if (!validMime || !validData || !isDimension(width) || !isDimension(height)) {
    throw new Error("invalid screen frame");
  }
  if (!isTimestamp(capturedAtMs)) {
    throw new Error("invalid screen frame");
  }
  return { mime, data, width, height, capturedAtMs };
}

/**
 * Next gap between frames. A round trip longer than the gap means the link is the bottleneck, so back off.
 * A quick round trip speeds the gap up again. The result stays inside the 2 to 10 fps band.
 */
export function nextFrameIntervalMs(currentMs: number, roundTripMs: number): number {
  const current = Math.min(SCREEN_WATCH_MAX_INTERVAL_MS, Math.max(SCREEN_WATCH_MIN_INTERVAL_MS, currentMs));
  if (roundTripMs >= current) {
    return Math.min(SCREEN_WATCH_MAX_INTERVAL_MS, Math.ceil(roundTripMs * 1.2));
  }
  return Math.max(SCREEN_WATCH_MIN_INTERVAL_MS, Math.round(current * 0.8));
}
