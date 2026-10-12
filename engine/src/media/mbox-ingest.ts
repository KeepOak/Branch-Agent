import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { htmlToText } from "html-to-text";
import { mboxParser } from "mbox-parser";
import slugifyPackage from "slugify";
const slugify = slugifyPackage.default;

// Port of Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597
// collector/processSingleFile/convert/asMbox.js. Storage and upload cleanup stay
// with the caller: parsing a supplied buffer never deletes the owner's source.
export type MboxDocument = {
  id: string;
  url: string;
  title: string;
  docAuthor?: string;
  description: string;
  docSource: string;
  chunkSource: string;
  published: string;
  wordCount: number;
  pageContent: string;
  token_count_estimate: number;
};
export type MboxMetadata = Partial<
  Pick<MboxDocument, "title" | "docAuthor" | "description" | "docSource" | "chunkSource">
>;
export type MboxIngestionResult = {
  success: boolean;
  reason: string | null;
  documents: MboxDocument[];
};

type IngestParams = {
  buffer: Buffer;
  filename: string;
  sourceUrl: string;
  published: string;
  metadata?: MboxMetadata;
  tokenizeString: (text: string) => number;
  signal?: AbortSignal;
};
type Mail = Awaited<ReturnType<typeof mboxParser>>[number];

function messageText(mail: Mail): string {
  if (mail.text?.trim()) return mail.text;
  if (!mail.html) return "";
  return htmlToText(mail.html, {
    wordwrap: false,
    preserveNewlines: true,
    limits: { maxDepth: 100 },
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "noscript", format: "skip" },
    ],
  });
}

function mailDocument(
  mail: Mail,
  content: string,
  item: number,
  params: IngestParams,
): MboxDocument {
  const metadata = params.metadata ?? {};
  const messageTitle = mail.subject
    ? `${slugify(mail.subject.replace(".", ""))}.mbox`
    : `msg_${item}-${params.filename}`;
  return {
    id: randomUUID(),
    url: params.sourceUrl,
    title: metadata.title ? `${metadata.title} - ${messageTitle}` : messageTitle,
    docAuthor: metadata.docAuthor || mail.from?.text,
    description: metadata.description || "No description found.",
    docSource: metadata.docSource || "Mbox message file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: params.published,
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: params.tokenizeString(content),
  };
}

function parserChunks(buffer: Buffer): Buffer[] {
  // 1.0.1's flush omits its callback when an empty EOF delimiter remains.
  // Its split filters empty segments, so a preceding message already flushes.
  return buffer.equals(Buffer.from("From ")) ? [buffer, Buffer.from("\n")] : [buffer];
}

/** Source-equivalent records without storage or upload cleanup side effects. */
export async function ingestMbox(params: IngestParams): Promise<MboxIngestionResult> {
  params.signal?.throwIfAborted();
  const empty = (): MboxIngestionResult => ({
    success: false,
    reason: `No mail items found in ${params.filename}.`,
    documents: [],
  });
  if (params.buffer.length === 0) return empty();
  const mails = await mboxParser(Readable.from(parserChunks(params.buffer))).catch(() => []);
  params.signal?.throwIfAborted();
  if (mails.length === 0) return empty();
  const documents: MboxDocument[] = [];
  for (const mail of mails) {
    params.signal?.throwIfAborted();
    const content = messageText(mail);
    if (content) documents.push(mailDocument(mail, content, documents.length + 1, params));
  }
  return { success: true, reason: null, documents };
}
