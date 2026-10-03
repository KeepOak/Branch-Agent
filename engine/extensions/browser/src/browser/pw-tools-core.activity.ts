/**
 * Page inspection helpers for visible text, observed errors, network requests,
 * and console messages from Playwright page state.
 */
import { withTimeout } from "branch/plugin-sdk/text-utility-runtime";
import type { Page } from "playwright-core";
import { DEFAULT_AI_SNAPSHOT_MAX_CHARS, DEFAULT_BROWSER_SNAPSHOT_TIMEOUT_MS } from "./constants.js";
import { readPageMarkdown, type BrowserPageTextResult } from "./pw-page-markdown.js";
import type {
  BrowserConsoleMessage,
  BrowserNetworkRequest,
  BrowserPageError,
} from "./pw-session.js";
import { ensurePageState, getPageForTargetId } from "./pw-session.js";
import {
  awaitActionWithAbort,
  createAbortPromiseWithListener,
} from "./pw-tools-core.interactions.navigation.js";

type PageTextOptions = {
  cdpUrl: string;
  targetId?: string;
  selector?: string;
  maxChars?: number;
  format?: "text" | "markdown";
  pageNumber?: number;
  signal?: AbortSignal;
};

/** Returns visible text or paginated Readability markdown from the current page. */
export async function getPageTextViaPlaywright(
  opts: PageTextOptions,
): Promise<BrowserPageTextResult> {
  const timeout = DEFAULT_BROWSER_SNAPSHOT_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  const controller = new AbortController();
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, controller.signal])
    : controller.signal;
  const { abortPromise, cleanup } = createAbortPromiseWithListener(signal);
  const read = async () => {
    signal.throwIfAborted();
    const page = await getPageForTargetId(opts);
    signal.throwIfAborted();
    if (opts.format === "markdown") {
      return await readPageMarkdown(page, opts);
    }
    return await readVisiblePageText(page, opts, signal, deadline);
  };
  try {
    return await withTimeout(awaitActionWithAbort(read(), abortPromise), timeout, {
      createError: () => {
        const error = new Error(`Page text extraction timed out after ${timeout}ms`);
        controller.abort(error);
        return error;
      },
    });
  } finally {
    cleanup();
  }
}

async function readVisiblePageText(
  page: Page,
  opts: PageTextOptions,
  signal: AbortSignal,
  deadline: number,
): Promise<BrowserPageTextResult> {
  const maxChars = Math.min(
    opts.maxChars ?? DEFAULT_AI_SNAPSHOT_MAX_CHARS,
    DEFAULT_AI_SNAPSHOT_MAX_CHARS,
  );
  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) {
    throw new Error("maxChars must be a positive integer.");
  }
  let locator = page.locator(opts.selector ?? "body").first();
  if (!opts.selector) {
    for (const selector of ["article", "main"]) {
      const candidate = page.locator(selector).first();
      const count = await candidate.count();
      signal.throwIfAborted();
      if (count) {
        locator = candidate;
        break;
      }
    }
  }
  // oxlint-disable-next-line unicorn/prefer-dom-node-text-content -- This action reads rendered text, not hidden DOM text.
  const text = await locator.innerText({ timeout: Math.max(1, deadline - Date.now()), signal });
  return { text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

/** Returns captured page errors, optionally clearing the per-page buffer. */
export async function getPageErrorsViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  clear?: boolean;
}): Promise<{ errors: BrowserPageError[] }> {
  const page = await getPageForTargetId(opts);
  const state = ensurePageState(page);
  const errors = [...state.errors];
  if (opts.clear) {
    state.errors = [];
  }
  return { errors };
}

/** Returns captured requests, optionally filtering URLs/resource types and clearing. */
export async function getNetworkRequestsViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  filter?: string;
  clear?: boolean;
}): Promise<{ requests: BrowserNetworkRequest[] }> {
  const page = await getPageForTargetId(opts);
  const state = ensurePageState(page);
  const raw = [...state.requests.values()];
  const filter = typeof opts.filter === "string" ? opts.filter.trim() : "";
  const requests = filter
    ? raw.filter((r) => r.url.includes(filter) || r.resourceType?.includes(filter))
    : raw;
  if (opts.clear) {
    state.requests.clear();
    state.requestIds = new WeakMap();
  }
  return { requests };
}

function consolePriority(level: string) {
  if (level === "error") {
    return 3;
  }
  if (level === "warn" || level === "warning") {
    return 2;
  }
  return level === "debug" ? 0 : 1;
}

/** Returns captured console messages at or above the requested priority level. */
export async function getConsoleMessagesViaPlaywright(opts: {
  cdpUrl: string;
  targetId?: string;
  level?: string;
}): Promise<BrowserConsoleMessage[]> {
  const page = await getPageForTargetId(opts);
  const state = ensurePageState(page);
  if (!opts.level) {
    return [...state.console];
  }
  const min = consolePriority(opts.level);
  return state.console.filter((msg) => consolePriority(msg.type) >= min);
}
