import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { mboxParser } from "mbox-parser";
import { htmlToText } from "html-to-text";
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
export type MboxMetadata = Partial<Pick<MboxDocument,
  "title" | "docAuthor" | "description" | "docSource" | "chunkSource"
>>;
export type MboxIngestionResult = {
  success: boolean;
  reason: string | null;
  documents: MboxDocument[];
};

/** One document per readable message, suitable for the caller's document store. */
export async function ingestMbox(params: {
  buffer: Buffer;
  filename: string;
  sourceUrl: string;
  published: string;
  metadata?: MboxMetadata;
  /** Use the document store's tokenizer; do not silently invent token estimates. */
  tokenizeString: (text: string) => number;
}): Promise<MboxIngestionResult> {
  const empty = (): MboxIngestionResult => ({
    success: false, reason: `No mail items found in ${params.filename}.`, documents: [],
  });
  // mbox-parser 1.0.1 never flushes an empty stream. Avoid a pending promise.
  if (params.buffer.length === 0) return empty();
  const mails = await mboxParser(Readable.from([params.buffer])).catch(() => []);
  if (mails.length === 0) return empty();
  const metadata = params.metadata ?? {};
  const documents: MboxDocument[] = [];
  let item = 1;
  for (const mail of mails) {
    const content = mail.text?.trim() ? mail.text : mail.html ? htmlToText(mail.html, {
      wordwrap: false,
      preserveNewlines: true,
      limits: { maxDepth: 100 },
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "noscript", format: "skip" },
      ],
    }) : "";
    if (!content) continue;
    const messageTitle = mail.subject
      ? `${slugify(mail.subject.replace(".", ""))}.mbox`
      : `msg_${item}-${params.filename}`;
    documents.push({
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
    });
    item++;
  }
  return { success: true, reason: null, documents };
}
