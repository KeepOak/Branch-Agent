/** Ported from browser-use/browser-use@4cbe921673b48a488f5415d9159249afd12a625b,
 * browser_use/tools/service.py search_page/find_elements and tools/views.py defaults. */
import { withTimeout } from "branch/plugin-sdk/text-utility-runtime";
import { DEFAULT_BROWSER_SNAPSHOT_TIMEOUT_MS } from "./constants.js";
import { getPageForTargetId } from "./pw-session.js";
import {
  awaitActionWithAbort,
  createAbortPromiseWithListener,
} from "./pw-tools-core.interactions.navigation.js";

export type SearchPageOptions = {
  pattern: string;
  regex?: boolean;
  caseSensitive?: boolean;
  contextChars?: number;
  cssScope?: string;
  maxResults?: number;
};
export type FindElementsOptions = {
  selector: string;
  attributes?: string[];
  includeText?: boolean;
  maxResults?: number;
};
export type PageSearchMatch = {
  matchText: string;
  context: string;
  elementPath: string;
  charPosition: number;
};
export type PageSearchResult = { matches: PageSearchMatch[]; total: number; hasMore: boolean };
export type PageFoundElement = {
  index: number;
  tag: string;
  text?: string;
  attrs?: Record<string, string>;
  childrenCount: number;
};
export type PageFindResult = { elements: PageFoundElement[]; total: number; showing: number };
type InspectionTarget = { cdpUrl: string; targetId?: string; signal?: AbortSignal };

function readInteger(value: unknown, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function readBoolean(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean.`);
  }
  return value;
}

export function readSearchPageOptions(
  input: Record<string, unknown>,
): Required<Omit<SearchPageOptions, "cssScope">> & { cssScope?: string } {
  if (typeof input.pattern !== "string") {
    throw new Error("pattern must be a string.");
  }
  if (input.cssScope !== undefined && typeof input.cssScope !== "string") {
    throw new Error("cssScope must be a string.");
  }
  return {
    pattern: input.pattern,
    regex: readBoolean(input.regex, "regex", false),
    caseSensitive: readBoolean(input.caseSensitive, "caseSensitive", false),
    contextChars: readInteger(input.contextChars, "contextChars", 150),
    cssScope: input.cssScope as string | undefined,
    maxResults: readInteger(input.maxResults, "maxResults", 25),
  };
}

export function readFindElementsOptions(
  input: Record<string, unknown>,
): Required<Omit<FindElementsOptions, "attributes">> & { attributes?: string[] } {
  if (typeof input.selector !== "string") {
    throw new Error("selector must be a string.");
  }
  if (
    input.attributes !== undefined &&
    (!Array.isArray(input.attributes) ||
      input.attributes.some((value) => typeof value !== "string"))
  ) {
    throw new Error("attributes must be an array of strings.");
  }
  return {
    selector: input.selector,
    attributes: input.attributes as string[] | undefined,
    maxResults: readInteger(input.maxResults, "maxResults", 50),
    includeText: readBoolean(input.includeText, "includeText", true),
  };
}

function elementPath(element: Element | null): string {
  const parts: string[] = [];
  for (
    let current = element;
    current && current !== document.body;
    current = current.parentElement
  ) {
    let description = current.tagName.toLowerCase();
    if (current.id) {
      description += `#${current.id}`;
    } else if (typeof current.className === "string") {
      const classes = current.className.trim().split(/\s+/).slice(0, 2).join(".");
      if (classes) {
        description += `.${classes}`;
      }
    }
    parts.unshift(description);
  }
  return parts.join(" > ");
}

function collectPageText(scope: Element) {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const offsets: { offset: number; length: number; node: Node }[] = [];
  let text = "";
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const content = node.textContent;
    if (content?.trim()) {
      offsets.push({ offset: text.length, length: content.length, node });
      text += content;
    }
  }
  return { text, offsets };
}

function searchDomText(opts: ReturnType<typeof readSearchPageOptions>): PageSearchResult {
  const scope = opts.cssScope ? document.querySelector(opts.cssScope) : document.body;
  if (!scope) {
    throw new Error(`CSS scope selector not found: ${opts.cssScope ?? "body"}`);
  }
  const { text, offsets } = collectPageText(scope);
  const pattern = opts.regex ? opts.pattern : opts.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(pattern, opts.caseSensitive ? "g" : "gi");
  const matches: PageSearchMatch[] = [];
  let total = 0;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(text)) !== null) {
    total++;
    if (matches.length < opts.maxResults) {
      const start = Math.max(0, match.index - opts.contextChars);
      const end = Math.min(text.length, match.index + match[0].length + opts.contextChars);
      const offset = offsets.find(
        (item) => item.offset <= match!.index && item.offset + item.length > match!.index,
      );
      matches.push({
        matchText: match[0],
        context: `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`,
        elementPath: elementPath(offset?.node.parentElement ?? null),
        charPosition: match.index,
      });
    }
    if (match[0].length === 0) {
      expression.lastIndex++;
    }
  }
  return { matches, total, hasMore: total > opts.maxResults };
}

function findDomElements(opts: ReturnType<typeof readFindElementsOptions>): PageFindResult {
  const elements = document.querySelectorAll(opts.selector);
  const total = elements.length;
  const showing = Math.min(total, opts.maxResults);
  const results: PageFoundElement[] = [];
  for (let index = 0; index < showing; index++) {
    const element = elements[index]!;
    const item: PageFoundElement = {
      index,
      tag: element.tagName.toLowerCase(),
      childrenCount: element.children.length,
    };
    if (opts.includeText) {
      const text = (element.textContent ?? "").trim();
      item.text = text.length > 300 ? `${text.slice(0, 300)}...` : text;
    }
    if (opts.attributes?.length) {
      item.attrs = {};
      for (const name of opts.attributes) {
        const property: unknown =
          name === "src" || name === "href" ? Reflect.get(element, name) : undefined;
        const value =
          typeof property === "string" && property ? property : element.getAttribute(name);
        if (value !== null) {
          item.attrs[name] = value.length > 500 ? `${value.slice(0, 500)}...` : value;
        }
      }
    }
    results.push(item);
  }
  return { elements: results, total, showing };
}

async function inspectPage<T>(target: InspectionTarget, expression: string): Promise<T> {
  const controller = new AbortController();
  const signal = target.signal
    ? AbortSignal.any([target.signal, controller.signal])
    : controller.signal;
  const { abortPromise, cleanup } = createAbortPromiseWithListener(signal);
  const read = async () => {
    signal.throwIfAborted();
    const page = await getPageForTargetId(target);
    signal.throwIfAborted();
    return await page.evaluate<T>(expression);
  };
  try {
    return await withTimeout(
      awaitActionWithAbort(read(), abortPromise),
      DEFAULT_BROWSER_SNAPSHOT_TIMEOUT_MS,
      {
        createError: () => {
          const error = new Error("Page inspection timed out.");
          controller.abort(error);
          return error;
        },
      },
    );
  } finally {
    cleanup();
  }
}

export async function searchPageViaPlaywright(
  opts: InspectionTarget & SearchPageOptions,
): Promise<PageSearchResult> {
  const input = readSearchPageOptions(opts);
  const expression = `(() => { const elementPath = ${elementPath}; const collectPageText = ${collectPageText}; const searchDomText = ${searchDomText}; return searchDomText(${JSON.stringify(input)}); })()`;
  return await inspectPage(opts, expression);
}

export async function findElementsViaPlaywright(
  opts: InspectionTarget & FindElementsOptions,
): Promise<PageFindResult> {
  const input = readFindElementsOptions(opts);
  const expression = `(() => { const findDomElements = ${findDomElements}; return findDomElements(${JSON.stringify(input)}); })()`;
  return await inspectPage(opts, expression);
}
