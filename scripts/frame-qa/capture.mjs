// Frame capture over CDP screencast. Chromium emits a frame only when the picture changes, and every
// frame is acknowledged so the stream keeps flowing. Recent frames keep their image data as evidence.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIET_MS, blankFrames, BLANK_BYTES, SLOW_PAINT_MS, findFlickers, firstChangeMs, frameIntervalMedian, hashFrame, idleChurn, stableMs } from './analyze.mjs';

const KEEP_IMAGE_MS = 5000;
const KEEP_FRAME_MS = 30000;

/** Ring of recent frames. Old image data is dropped; hashes and sizes are kept for analysis. */
export class FrameRing {
  constructor(now = Date.now) {
    this.now = now;
    this.frames = [];
  }

  push(data) {
    const t = this.now();
    const frame = { t, hash: hashFrame(data), bytes: Math.floor((data.length * 3) / 4), data };
    this.frames.push(frame);
    this.prune(t);
    return frame;
  }

  prune(t) {
    while (this.frames.length && t - this.frames[0].t > KEEP_FRAME_MS) this.frames.shift();
    for (const frame of this.frames) {
      if (t - frame.t <= KEEP_IMAGE_MS) break;
      frame.data = null;
    }
  }

  /** Frames between two epoch times, without image data. */
  between(from, to) {
    return this.frames.filter((f) => f.t >= from && f.t <= to).map(({ t, hash, bytes }) => ({ t, hash, bytes }));
  }

  /** The latest frame that still carries image data, closest to t. */
  imageAt(t) {
    let best = null;
    for (const frame of this.frames) {
      if (frame.data && (!best || Math.abs(frame.t - t) < Math.abs(best.t - t))) best = frame;
    }
    return best;
  }

  latestHash() {
    return this.frames.length ? this.frames[this.frames.length - 1].hash : null;
  }
}

/** Starts the screencast on a page. Returns the ring and a stop function. */
export async function startScreencast(page) {
  const ring = new FrameRing();
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', (frame) => {
    ring.push(frame.data);
    cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, everyNthFrame: 1 });
  return { ring, stop: () => cdp.send('Page.stopScreencast').catch(() => undefined) };
}

/** Waits until no frame has arrived for quietMs, or gives up after maxMs. */
export async function waitQuiet(ring, quietMs = 150, maxMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const last = ring.frames.at(-1)?.t ?? 0;
    if (Date.now() - last >= quietMs) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

/** Saves one frame as a JPEG under outDir/frames and returns the file name. */
export function saveFrame(outDir, name, frame) {
  if (!frame || !frame.data) return null;
  const file = `${name}.jpg`;
  writeFileSync(join(outDir, 'frames', file), Buffer.from(frame.data, 'base64'));
  return file;
}

/** Blank-before-content: a flat frame comes before the first content frame after t0. */
export function blankBeforeContent(frames, t0) {
  const blanks = blankFrames(frames.filter((f) => f.t >= t0));
  if (!blanks.length) return null;
  const firstContent = frames.find((f) => f.t >= t0 && f.bytes >= BLANK_BYTES && f.t > blanks[0].t);
  if (!firstContent) return null;
  return { blankFrames: blanks.length, contentAfterMs: firstContent.t - t0 };
}

/**
 * Everything the frames say about one window that starts at t0. Returns numbers and flags only;
 * evidence images are saved by the caller from the same ring.
 */
export function analyzeWindow(ring, { t0, windowMs = 2000, lastInputAt = t0 }) {
  const frames = ring.between(t0 - 1000, t0 + windowMs);
  const inWindow = frames.filter((f) => f.t >= t0);
  const flickers = findFlickers(inWindow);
  return {
    frameCount: inWindow.length,
    intervalMedianMs: frameIntervalMedian(inWindow),
    firstChangeMs: firstChangeMs(frames, t0),
    stableMs: stableMs(frames, t0, QUIET_MS, t0 + windowMs),
    slowPaint: (firstChangeMs(frames, t0) ?? 0) > SLOW_PAINT_MS || (stableMs(frames, t0, QUIET_MS, t0 + windowMs) ?? 0) > SLOW_PAINT_MS,
    flickers,
    blankBefore: blankBeforeContent(frames, t0),
    idle: idleChurn(ring.between(lastInputAt - 1000, lastInputAt + 5000), lastInputAt),
  };
}
