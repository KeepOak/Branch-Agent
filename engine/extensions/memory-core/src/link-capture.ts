// Adapted from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf
// plugins/plugin-assistant/src/features/basic-capabilities/evaluators/link-extraction.ts,
// packages/core/src/utils/html-raw-text.ts.
// Auto-captures http(s) URLs from inbound messages, fetches a title/summary
// preview through the SSRF guard and keeps each link as a memory entry in
// memory/links.md. URLs are attacker-controlled: every preview fetch goes
// through the guard, and capture is best-effort (the raw URL is still kept
// when the preview or summary fails).
import { fetchWithSsrFGuard } from "branch/plugin-sdk/ssrf-runtime";

export const LINK_MEMORY_PATH = "memory/links.md";
const URL_REGEX = /https?:\/\/[^\s<>"'`)]+/gi;
const SUMMARY_FETCH_TIMEOUT_MS = 5_000;

export interface LinkRecord {
  url: string;
  title: string;
  summary: string;
}

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) {
    return [];
  }
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of matches) {
    const trimmed = stripTrailingPunctuation(raw);
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    urls.push(trimmed);
  }
  return urls;
}

function stripTrailingPunctuation(url: string): string {
  let result = url;
  while (result.length > 0 && /[.,;:!?\])}>]/.test(result.slice(-1))) {
    result = result.slice(0, -1);
  }
  return result;
}

export function hasUrl(text: string): boolean {
  URL_REGEX.lastIndex = 0;
  return URL_REGEX.test(text);
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    "#39": "'",
  };
  return value.replace(
    /&(amp|lt|gt|quot|#39|nbsp);/gi,
    (entity, name: string) => namedEntities[name.toLowerCase()] ?? entity,
  );
}

export function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    return decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim();
  }
  const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogMatch?.[1]) {
    return decodeHtmlEntities(ogMatch[1]).trim();
  }
  return "";
}

// --- html-raw-text.ts: remove script/style elements with a bounded tokenizer pass ---

const RAW_TEXT_TAGS = ["script", "style"] as const;
type RawTextTag = (typeof RAW_TEXT_TAGS)[number];

function isAsciiWhitespace(character: string): boolean {
  return (
    character === "\t" ||
    character === "\n" ||
    character === "\f" ||
    character === "\r" ||
    character === " "
  );
}

function matchesAsciiCaseInsensitive(value: string, index: number, expected: string): boolean {
  if (index + expected.length > value.length) {
    return false;
  }
  for (let offset = 0; offset < expected.length; offset += 1) {
    const code = value.charCodeAt(index + offset);
    const normalized = code >= 65 && code <= 90 ? code + 32 : code;
    if (normalized !== expected.charCodeAt(offset)) {
      return false;
    }
  }
  return true;
}

function isTagNameDelimiter(character: string | undefined): boolean {
  return (
    character === undefined ||
    character === ">" ||
    character === "/" ||
    isAsciiWhitespace(character)
  );
}

function findTagEnd(value: string, index: number): number {
  let quote: '"' | "'" | null = null;
  for (let cursor = index; cursor < value.length; cursor += 1) {
    const character = value[cursor];
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return cursor + 1;
    }
  }
  return value.length;
}

function matchTag(value: string, index: number, tagName: RawTextTag, closing: boolean): number | null {
  if (value[index] !== "<") {
    return null;
  }
  const nameIndex = index + (closing ? 2 : 1);
  if (closing && value[index + 1] !== "/") {
    return null;
  }
  if (!matchesAsciiCaseInsensitive(value, nameIndex, tagName)) {
    return null;
  }
  const afterName = nameIndex + tagName.length;
  if (!isTagNameDelimiter(value[afterName])) {
    return null;
  }
  return findTagEnd(value, afterName);
}

function hasDelimitedTagName(value: string, nameIndex: number, tagName: RawTextTag): boolean {
  return (
    matchesAsciiCaseInsensitive(value, nameIndex, tagName) &&
    isTagNameDelimiter(value[nameIndex + tagName.length])
  );
}

function findRawTextClosingEnd(value: string, index: number, tagName: RawTextTag): number | null {
  for (let cursor = index; cursor < value.length; cursor += 1) {
    if (value[cursor] !== "<" || value[cursor + 1] !== "/") {
      continue;
    }
    const closingEnd = matchTag(value, cursor, tagName, true);
    if (closingEnd !== null) {
      return closingEnd;
    }
  }
  return null;
}

/**
 * Find the end of script data while preserving the browser tokenizer's escape
 * transitions. A script end-tag token seen while double-escaped only returns
 * the tokenizer to the escaped state; a later appropriate token closes it.
 */
function findScriptClosingEnd(value: string, index: number): number | null {
  let state: "data" | "escaped" | "double-escaped" = "data";
  let cursor = index;
  while (cursor < value.length) {
    if (value.startsWith("-->", cursor)) {
      state = "data";
      cursor += 3;
      continue;
    }
    if (state === "data" && value.startsWith("<!--", cursor)) {
      state = "escaped";
      cursor += 4;
      continue;
    }
    if (value[cursor] === "<" && value[cursor + 1] === "/") {
      const nameIndex = cursor + 2;
      if (hasDelimitedTagName(value, nameIndex, "script")) {
        if (state === "double-escaped") {
          state = "escaped";
          cursor = nameIndex + "script".length;
          continue;
        }
        return findTagEnd(value, nameIndex + "script".length);
      }
    }
    if (state === "escaped" && value[cursor] === "<" && hasDelimitedTagName(value, cursor + 1, "script")) {
      state = "double-escaped";
      cursor += 1 + "script".length;
      continue;
    }
    cursor += 1;
  }
  return null;
}

/** Remove script/style elements, including parser-accepted malformed end tags. */
export function stripHtmlRawTextElements(value: string): string {
  const output: string[] = [];
  let copiedThrough = 0;
  let cursor = 0;
  while (cursor < value.length) {
    if (value[cursor] !== "<") {
      cursor += 1;
      continue;
    }
    let matchedTag: RawTextTag | null = null;
    let openingEnd = 0;
    for (const tagName of RAW_TEXT_TAGS) {
      const end = matchTag(value, cursor, tagName, false);
      if (end !== null) {
        matchedTag = tagName;
        openingEnd = end;
        break;
      }
    }
    if (matchedTag === null) {
      cursor += 1;
      continue;
    }
    output.push(value.slice(copiedThrough, cursor), " ");
    cursor = openingEnd;
    const closingEnd =
      matchedTag === "script"
        ? findScriptClosingEnd(value, cursor)
        : findRawTextClosingEnd(value, cursor, matchedTag);
    copiedThrough = closingEnd ?? value.length;
    cursor = copiedThrough;
  }
  output.push(value.slice(copiedThrough));
  return output.join("");
}

function stripTags(html: string): string {
  return stripHtmlRawTextElements(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- preview fetch + summary ---

/** DNS + transport injection for the guarded preview fetch (deterministic-test seam). */
export type LinkPreviewTransport = Pick<
  Parameters<typeof fetchWithSsrFGuard>[0],
  "fetchImpl" | "lookupFn"
>;

let linkPreviewTransportForTests: LinkPreviewTransport | undefined;

/** Test seam: inject (or clear with `undefined`) the guarded preview transport. */
export function setLinkPreviewTransportForTests(transport: LinkPreviewTransport | undefined): void {
  linkPreviewTransportForTests = transport;
}

export async function fetchLinkPreview(
  url: string,
): Promise<{ title: string; bodyChunk: string } | null> {
  let release: (() => Promise<void>) | undefined;
  try {
    const guarded = await fetchWithSsrFGuard({
      url,
      timeoutMs: SUMMARY_FETCH_TIMEOUT_MS,
      auditContext: "memory-core-link-capture",
      init: {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0 (compatible; BranchLinkPreview/1.0)",
        },
      },
      ...linkPreviewTransportForTests,
    });
    release = guarded.release;
    const { response } = guarded;
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      return null;
    }
    const html = await response.text();
    return { title: extractTitle(html), bodyChunk: stripTags(html) };
  } catch {
    // Link previews are optional enrichments; blocked, unreachable, or invalid
    // external URLs produce no preview.
    return null;
  } finally {
    await release?.();
  }
}

export type LinkSummarizer = (prompt: string) => Promise<string>;

export function buildLinkSummaryPrompt(url: string, title: string, bodyChunk: string): string {
  return `Summarize the following web page in one short paragraph (max 3 sentences). Focus on what the page is about. Do not invent details.

URL: ${url}
Title: ${title || "(unknown)"}
Body excerpt:
${bodyChunk}

Summary:`;
}

export async function buildLinkRecord(
  url: string,
  summarize: LinkSummarizer,
  warn: (message: string) => void,
): Promise<LinkRecord> {
  const record: LinkRecord = { url, title: "", summary: "" };
  const preview = await fetchLinkPreview(url);
  if (!preview) {
    return record;
  }
  record.title = preview.title;
  if (!preview.bodyChunk.trim()) {
    return record;
  }
  try {
    record.summary = (await summarize(buildLinkSummaryPrompt(url, preview.title, preview.bodyChunk))).trim();
  } catch (error) {
    // Link enrichment is optional; keep the captured link without a summary.
    warn(`memory-core: link summarization failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return record;
}

/** One Markdown memory entry per captured link, stamped with its platform. */
export function formatLinkEntry(link: LinkRecord, platform: string, capturedAt: Date): string {
  const title = link.title && link.summary ? ` "${link.title}"` : "";
  const text = link.summary || link.title;
  const date = capturedAt.toISOString().slice(0, 10);
  return `${link.url}${title}${text ? ` — ${text}` : ""} (link, auto_capture, platform:${platform}, ${date})`;
}
