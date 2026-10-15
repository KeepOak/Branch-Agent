// Pure rules for the browser pane: what the address bar does with what was typed, and which keys reach the page.
// The address bar follows Chrome's rule: a web address navigates, anything else searches the web.

export type BrowserInput =
  | { kind: "empty" }
  | { kind: "url"; url: string }
  | { kind: "search"; url: string; query: string };

export const SEARCH_ENDPOINT = "https://duckduckgo.com/?q=";
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
// localhost, IPv4 and bracketed IPv6, with an optional port and path. Local development hosts open over http.
const LOCAL_HOST = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])(?::\d{1,5})?(?:[/?#]\S*)?$/i;
// A dotted name with an alphabetic top level domain, such as keepoak.com or docs.example.org:8443/a.
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i;

function search(query: string): BrowserInput {
  return { kind: "search", query, url: `${SEARCH_ENDPOINT}${encodeURIComponent(query)}` };
}

/** The address as typed, with its scheme, when it parses and uses a web scheme. */
function absolute(candidate: string): string | null {
  try {
    const parsed = new URL(candidate);
    if (candidate === "about:blank") return candidate;
    return ALLOWED_SCHEMES.has(parsed.protocol) ? candidate : null;
  } catch {
    return null;
  }
}

/** What the address bar does with typed text: navigate to an address, or search for words. */
export function resolveBrowserInput(raw: string): BrowserInput {
  const text = raw.trim();
  if (!text) return { kind: "empty" };
  if (/\s/.test(text)) return search(text);
  if (text === "about:blank") return { kind: "url", url: "about:blank" };
  if (LOCAL_HOST.test(text)) {
    const url = absolute(`http://${text}`);
    return url ? { kind: "url", url } : search(text);
  }
  if (DOMAIN.test(text)) {
    const url = absolute(`https://${text}`);
    return url ? { kind: "url", url } : search(text);
  }
  if (SCHEME.test(text)) {
    // A typed scheme is kept only for web pages. javascript:, data:, file: and the rest become a search.
    const url = absolute(text);
    return url ? { kind: "url", url } : search(text);
  }
  return search(text);
}

const PAGE_KEYS = new Set([
  "Enter",
  "Backspace",
  "Delete",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export type KeyEventLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

/**
 * The key name to press on the page, or null. Printable characters are not forwarded as key presses: they arrive
 * as text (insertText), which works for hardware keyboards, phone keyboards and IME alike.
 */
export function forwardedKey(event: KeyEventLike): string | null {
  if (event.isComposing || event.keyCode === 229) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return PAGE_KEYS.has(event.key) ? event.key : null;
}

/** The key a text-editing input type stands for on the page, when it is not plain text. */
export function editingKey(inputType: string): string | null {
  switch (inputType) {
    case "deleteContentBackward":
      return "Backspace";
    case "deleteContentForward":
      return "Delete";
    case "insertLineBreak":
    case "insertParagraph":
      return "Enter";
    default:
      return null;
  }
}
