// Adapted from AnythingLLM 4bff9da5 asEPub.js, langchain 0.1.36 EPubLoader,
// and epub2-static eb0a45cd lib/epub.js: archive container -> manifest -> spine.
import { posix } from "node:path";
import { DOMParser, type Document, type Element } from "@xmldom/xmldom";
import { htmlToText } from "html-to-text";
import JSZip from "jszip";

function xml(text: string): Document {
  return new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") {
        throw new Error(`Invalid EPUB XML: ${message}`);
      }
    },
  }).parseFromString(text, "application/xml");
}

function elements(document: Document, name: string, parent?: string): Element[] {
  return Array.from(document.getElementsByTagName("*")).filter(
    (element) =>
      element.localName === name &&
      (!parent || element.parentNode?.nodeName.split(":").at(-1) === parent),
  );
}

async function entryText(zip: JSZip, name: string, ignoreCase = false): Promise<string> {
  const key = ignoreCase
    ? Object.keys(zip.files).find((entry) => entry.toLowerCase() === name.toLowerCase())
    : name;
  const entry = key ? zip.file(key) : undefined;
  if (!entry) {
    throw new Error(`EPUB archive entry not found: ${name}`);
  }
  return await entry.async("string");
}

async function packageDocument(zip: JSZip): Promise<{ document: Document; root: string }> {
  if ((await entryText(zip, "mimetype", true)).toLowerCase().trim() !== "application/epub+zip") {
    throw new Error("Unsupported EPUB mime type");
  }
  const container = xml(
    (await entryText(zip, "META-INF/container.xml", true)).toLowerCase().trim(),
  );
  const requestedRoot = elements(container, "rootfile", "rootfiles")
    .find((element) => element.getAttribute("media-type") === "application/oebps-package+xml")
    ?.getAttribute("full-path");
  if (!requestedRoot) {
    throw new Error("EPUB container has no package rootfile");
  }
  const root = Object.keys(zip.files).find(
    (entry) => entry.toLowerCase() === requestedRoot.trim().toLowerCase(),
  );
  if (!root) {
    throw new Error(`EPUB package rootfile not found: ${requestedRoot}`);
  }
  return { document: xml(await entryText(zip, root)), root };
}

function chapterPath(root: string, href: string): string {
  const directory = posix.dirname(root);
  return posix.normalize(
    directory === "." || href.startsWith(`${directory}/`) ? href : posix.join(directory, href),
  );
}

async function chapterText(
  zip: JSZip,
  root: string,
  chapter: Element,
): Promise<string | undefined> {
  const mime = chapter.getAttribute("media-type");
  if (mime !== "application/xhtml+xml" && mime !== "image/svg+xml") {
    throw new Error(`Invalid EPUB chapter media type: ${mime}`);
  }
  const href = chapter.getAttribute("href");
  if (!href) {
    throw new Error("EPUB chapter has no href");
  }
  const html = await entryText(zip, chapterPath(root, href));
  return html ? htmlToText(html) : undefined;
}

/** Convert the book's reading order to text, matching EPubLoader splitChapters:false. */
export async function extractEpubText(
  buffer: Buffer,
  filename: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  try {
    const zip = await JSZip.loadAsync(buffer);
    const { document, root } = await packageDocument(zip);
    const manifest = new Map(
      elements(document, "item", "manifest")
        .filter((item) => item.getAttribute("id"))
        .map((item) => [item.getAttribute("id"), item]),
    );
    const chapters: string[] = [];
    for (const reference of elements(document, "itemref", "spine")) {
      signal?.throwIfAborted();
      const chapter = manifest.get(reference.getAttribute("idref"));
      if (chapter) {
        const text = await chapterText(zip, root, chapter);
        if (text !== undefined) {
          chapters.push(text);
        }
      }
    }
    signal?.throwIfAborted();
    const text = chapters.join("\n\n");
    if (text) {
      return text;
    }
  } catch (cause) {
    signal?.throwIfAborted();
    throw new Error(`No text content found in ${filename}.`, { cause });
  }
  throw new Error(`No text content found in ${filename}.`);
}
