// Adapted from Kilo-Org/kilocode 6fd9b7b: packages/opencode/src/kilocode/tool/read-extract.ts.
import { extname } from "node:path";

export type OfficeContent =
  | { kind: "text"; text: string }
  | { kind: "stream"; chunks: Iterable<string> };

/** Extract immutable Office bytes after the reader's normal access and queue checks. */
export async function extractOfficeContent(
  filePath: string,
  buffer: Buffer,
  signal?: AbortSignal,
): Promise<OfficeContent | undefined> {
  const extension = extname(filePath).toLowerCase();
  // Keep the reader's byte-based classification: an Office suffix does not make text binary.
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return undefined;
  }
  signal?.throwIfAborted();
  let content: OfficeContent;
  if (extension === ".docx") {
    const { extractDocxText } = await import("./office-docx.js");
    content = { kind: "text", text: await extractDocxText(filePath, buffer) };
  } else if (extension === ".xlsx" || extension === ".ods") {
    const { extractSpreadsheetChunks } = await import("./office-spreadsheet.js");
    content = { kind: "stream", chunks: extractSpreadsheetChunks(filePath, buffer) };
  } else {
    return undefined;
  }
  signal?.throwIfAborted();
  return content;
}
