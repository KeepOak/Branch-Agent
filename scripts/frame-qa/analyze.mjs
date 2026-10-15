// Pure analysis over captured frames and probe samples. No browser, no I/O.
// Frames are { t, hash, bytes } with t in epoch milliseconds, ordered by t.

import { createHash } from 'node:crypto';

export const FLICKER_MS = 300;
export const SLOW_PAINT_MS = 200;
export const QUIET_MS = 100;
export const BLANK_BYTES = 8000;
export const CHURN_FROM_MS = 2000;
export const CHURN_TO_MS = 5000;
export const LAYOUT_SHIFT_MIN = 0.001;
export const JUMP_MIN_PX = 30;

/** Short content hash of one screencast frame. */
export function hashFrame(data) {
  return createHash('sha1').update(data).digest('hex').slice(0, 16);
}

/** Collapses consecutive identical frames into runs { hash, start, end, count }. */
export function runsOf(frames) {
  const runs = [];
  for (const frame of frames) {
    const last = runs.at(-1);
    if (last && last.hash === frame.hash) {
      last.end = frame.t;
      last.count += 1;
    } else {
      runs.push({ hash: frame.hash, start: frame.t, end: frame.t, count: 1 });
    }
  }
  return runs;
}

/** A change that returns to the earlier picture within windowMs is a flicker. */
export function findFlickers(frames, windowMs = FLICKER_MS) {
  const runs = runsOf(frames);
  const found = [];
  for (let j = 1; j < runs.length - 1; j += 1) {
    const before = runs[j - 1];
    const middle = runs[j];
    const after = runs[j + 1];
    if (before.hash !== after.hash || middle.hash === before.hash) continue;
    const gapMs = after.start - before.end;
    if (gapMs <= windowMs) {
      found.push({ fromT: before.end, toT: middle.start, backT: after.start, gapMs, aHash: before.hash, bHash: middle.hash });
    }
  }
  return found;
}

/** Times of frames whose picture differs from the frame before them, from t0 on. */
export function changeTimes(frames, t0) {
  const times = [];
  let previous = null;
  for (const frame of frames) {
    if (previous && frame.t >= t0 && frame.hash !== previous.hash) times.push(frame.t);
    previous = frame;
  }
  return times;
}

/** Milliseconds from t0 to the first picture change, or null when nothing changed. */
export function firstChangeMs(frames, t0) {
  const [first] = changeTimes(frames, t0);
  return first === undefined ? null : first - t0;
}

/**
 * Milliseconds from t0 to the first stable picture: the last change of the first burst, where a burst
 * ends when the next change is more than quietMs later. A picture that is still changing at endT never
 * settles, so the result is null. Live content (a mirror, a ticking meter) reports as churn instead.
 */
export function stableMs(frames, t0, quietMs = QUIET_MS, endT = Infinity) {
  const times = changeTimes(frames, t0);
  if (!times.length) return null;
  let index = 0;
  while (index + 1 < times.length && times[index + 1] - times[index] <= quietMs) index += 1;
  const settled = index + 1 < times.length || endT - times[index] >= quietMs;
  return settled ? times[index] - t0 : null;
}

/** Number of one-second bins between from and to (epoch ms) that contain a picture change. */
export function churnBins(frames, from, to, binMs = 1000) {
  const times = changeTimes(frames, from);
  const bins = Math.max(1, Math.ceil((to - from) / binMs));
  const hit = new Array(bins).fill(false);
  for (const t of times) {
    if (t >= to) break;
    hit[Math.floor((t - from) / binMs)] = true;
  }
  return { bins: hit, changedBins: hit.filter(Boolean).length };
}

/** Idle churn: picture changes in two or more bins between 2 s and 5 s after the last input. */
export function idleChurn(frames, lastInputAt) {
  const from = lastInputAt + CHURN_FROM_MS;
  const to = lastInputAt + CHURN_TO_MS;
  const { bins, changedBins } = churnBins(frames, from, to);
  return { flagged: changedBins >= 2, changedBins, bins };
}

/** Frames whose compressed size is below the threshold are nearly one flat colour. */
export function blankFrames(frames, threshold = BLANK_BYTES) {
  return frames.filter((frame) => frame.bytes < threshold);
}

/** Layout shifts the browser reports without a recent user input. */
export function layoutShiftFindings(shifts) {
  return shifts.filter((shift) => !shift.hadRecentInput && shift.value >= LAYOUT_SHIFT_MIN);
}

/** Scroll position jumps that happen without user input. */
export function scrollResetFindings(jumps) {
  return jumps.filter((jump) => Math.abs(jump.to - jump.from) >= JUMP_MIN_PX);
}

/** Median gap between consecutive changed frames, the capture cadence actually achieved. */
export function frameIntervalMedian(frames) {
  const gaps = [];
  for (let i = 1; i < frames.length; i += 1) {
    if (frames[i].hash !== frames[i - 1].hash) gaps.push(frames[i].t - frames[i - 1].t);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}
