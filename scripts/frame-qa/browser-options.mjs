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

/** Opens one root's context and starts its trace with the trace options. Takes the browser as a parameter so tests can pass a fake. */
export async function openRootContext(browser, { out, safe }) {
  const context = await browser.newContext(contextOptions({ out, safe }));
  await context.tracing.start(TRACE_OPTIONS);
  return context;
}
