// Browser context and trace settings, kept pure so tests can check them without a browser.
// Traces keep DOM snapshots but no screenshots, and video is capped, so output stays small on a full disk.

import { join } from 'node:path';

export const VIEWPORT = { width: 1440, height: 900 };
export const VIDEO_SIZE = { width: 960, height: 600 };
export const TRACE_OPTIONS = { screenshots: false, snapshots: true };

/** Options for one root's browser context. */
export function contextOptions({ out, safe }) {
  return { viewport: VIEWPORT, recordVideo: { dir: join(out, 'videos', safe), size: VIDEO_SIZE } };
}
