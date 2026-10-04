import { basename, extname } from "node:path";
import type { MboxDocument } from "./mbox-ingest.js";

export function isMboxPath(filePath: string): boolean {
  return extname(filePath).toLowerCase() === ".mbox";
}

function* jsonString(value: string): Generator<string> {
  yield '"';
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 1024, value.length);
    const prior = value.charCodeAt(end - 1);
    const next = value.charCodeAt(end);
    if (prior >= 0xd800 && prior <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    yield JSON.stringify(value.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}

/** Serialize records with only a bounded escaped piece, including long bodies. */
export function* mboxDocumentChunks(documents: MboxDocument[]): Generator<string> {
  if (documents.length === 0) yield "[]";
  for (const [index, document] of documents.entries()) {
    if (index > 0) yield "\n";
    yield "{";
    let separator = "";
    for (const [key, value] of Object.entries(document)) {
      if (value === undefined) continue;
      yield `${separator}${JSON.stringify(key)}:`;
      if (typeof value === "string") yield* jsonString(value);
      else yield JSON.stringify(value);
      separator = ",";
    }
    yield "}";
  }
}

export async function extractMboxContent(params: {
  absolutePath: string;
  buffer: Buffer;
  published: string;
  signal?: AbortSignal;
}): Promise<Iterable<string>> {
  params.signal?.throwIfAborted();
  const [{ ingestMbox }, { tokenizeMboxString }] = await Promise.all([
    import("./mbox-ingest.js"),
    import("./mbox-tokenizer.js"),
  ]);
  const result = await ingestMbox({
    ...params,
    filename: basename(params.absolutePath),
    sourceUrl: `file://${params.absolutePath}`,
    tokenizeString: tokenizeMboxString,
  });
  if (!result.success) throw new Error(result.reason ?? "MBOX conversion failed");
  return mboxDocumentChunks(result.documents);
}
