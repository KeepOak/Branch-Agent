// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/processLink/index.js, processLink/convert/generic.js, processLink/helpers/index.js, utils/url/index.js.
// Upstream scrapes with a headless browser; Branch fetches through the SSRF guard and converts
// HTML with the web_fetch htmlToMarkdown. YouTube transcripts and file downloads are not handled.
import { htmlToMarkdown } from "branch/plugin-sdk/web-content-extractor";
import type { ConnectorFetch } from "./fetch.js";
import type { ConnectorDocument, ConnectorSource } from "./import.js";

const VALID_PROTOCOLS = ["https:", "http:"];

/** Assumes https:// when no protocol is given and drops a trailing slash. */
export function validateURL(url: string): string {
  try {
    let destination = url.trim();
    destination = destination.includes("://")
      ? new URL(destination).toString()
      : new URL(`https://${destination}`).toString();
    return destination.endsWith("/") ? destination.slice(0, -1) : destination;
  } catch {
    return typeof url === "string" ? url.trim() : "";
  }
}

export function validURL(url: string): boolean {
  try {
    return VALID_PROTOCOLS.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** The MIME type of a Content-Type header, without charset or other parameters. */
export function parseContentType(contentTypeHeader: string | null): string | null {
  if (!contentTypeHeader) {
    return null;
  }
  return contentTypeHeader.toLowerCase().split(";")[0]?.trim() || null;
}

/** Readable `/docs/café` from `/docs/caf%C3%A9`; undecodable paths are returned as-is. */
function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export type LinkConnectorLoad =
  | { success: true; source: ConnectorSource; documents: ConnectorDocument[] }
  | { success: false; reason: string };

export async function loadLinkConnectorDocument(params: {
  link: string;
  fetchImpl: ConnectorFetch;
}): Promise<LinkConnectorLoad> {
  const link = validateURL(params.link);
  if (!validURL(link)) {
    return { success: false, reason: "Not a valid URL." };
  }
  let response: Response;
  try {
    response = await params.fetchImpl(link, { method: "GET" });
  } catch (error) {
    return { success: false, reason: `Error: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!response.ok) {
    return { success: false, reason: `HTTP ${response.status}: ${response.statusText}` };
  }
  const contentType = parseContentType(response.headers.get("content-type"));
  const body = await response.text();
  let content = body;
  let pageTitle: string | undefined;
  if (contentType === "text/html" || contentType === null) {
    const rendered = htmlToMarkdown(body);
    content = rendered.text;
    pageTitle = rendered.title?.trim() || undefined;
  } else if (contentType !== "text/plain" && !contentType.startsWith("text/")) {
    return { success: false, reason: `Unsupported content type ${contentType} at ${link}.` };
  }
  if (!content || !content.trim().length) {
    return { success: false, reason: `No URL content found at ${link}.` };
  }
  const url = new URL(link);
  const filename = `${url.hostname}${decodePathname(url.pathname).replace(/\//g, "_")}`;
  return {
    success: true,
    source: { kind: "link", id: `link:${link}`, label: link },
    documents: [
      {
        key: link,
        title: pageTitle ?? filename,
        content,
        url: link,
        details: ["- Description: URL link uploaded by the user."],
      },
    ],
  };
}
