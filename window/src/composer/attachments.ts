// Files, pictures and long pasted text in the draft (DESIGN-SPEC §4.3.7 File chips, Pasted text chip), sent with
// chat.send's `attachments` as OpenClaw's browser UI does (ui/src/pages/chat/attachment-api.ts).
export type DraftFile = {
  id: string;
  kind: "file" | "text";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** base64 bytes, once read */
  content?: string;
  /** a data: URL for a picture's thumbnail */
  preview?: string;
  /** the text of a pasted-text chip */
  text?: string;
  origin: "file" | "paste";
  problem?: string;
  /** the engine's or browser's own words for the problem, shown as the chip's tooltip */
  detail?: string;
};

export type AttachmentPolicy = { maxBytes?: number; maxImageBytes?: number };

/** Pasting more than this many characters makes a chip instead (§4.3.7 "Pasted text" chip). */
export const PASTED_TEXT_CHIP_CHARS = 1000;

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/** The problem with a file before it is read, from the engine's own limits (hello.policy.attachments). */
export function sizeProblem(name: string, mimeType: string, size: number, policy: AttachmentPolicy | undefined): string | undefined {
  const limit = isImage(mimeType) ? (policy?.maxImageBytes ?? policy?.maxBytes) : policy?.maxBytes;
  return limit !== undefined && size > limit ? `Too large to send: ${name}` : undefined;
}

/** The size in the chip, in the units people read. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Preparing <n> attachments…" (one: "Preparing 1 attachment"). */
export function preparingLine(n: number): string {
  return n === 1 ? "Preparing 1 attachment" : `Preparing ${n} attachments…`;
}

/** The first 30 characters of pasted text, formatting removed, for its chip. */
export function pastedTitle(text: string): string {
  const plain = text.replace(/[*_`#>~[\]()]/g, "").replace(/\s+/g, " ").trim();
  return plain ? plain.slice(0, 30) : "Pasted text";
}

export function pastedTextFile(id: string, text: string): DraftFile {
  const bytes = new TextEncoder().encode(text);
  return {
    id,
    kind: "text",
    fileName: `${pastedTitle(text)}.txt`,
    mimeType: "text/plain",
    sizeBytes: bytes.byteLength,
    content: toBase64(bytes),
    text,
    origin: "paste",
  };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** The payload chat.send takes for the ready chips (attachment-api.ts buildChatApiAttachments). */
export function toChatAttachments(files: readonly DraftFile[]): Array<Record<string, unknown>> {
  return files
    .filter((f) => f.content && !f.problem)
    .map((f) => ({
      type: isImage(f.mimeType) ? "image" : "file",
      mimeType: f.mimeType,
      fileName: f.fileName,
      origin: f.origin,
      content: f.content,
    }));
}

/** Reads a picked, pasted or dropped file into a chip. */
export async function readDraftFile(id: string, file: File, origin: DraftFile["origin"], policy: AttachmentPolicy | undefined): Promise<DraftFile> {
  const mimeType = file.type || "application/octet-stream";
  const base: DraftFile = { id, kind: "file", fileName: file.name || "file", mimeType, sizeBytes: file.size, origin };
  const problem = sizeProblem(base.fileName, mimeType, file.size, policy);
  if (problem) {
    return { ...base, problem };
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const content = toBase64(bytes);
    return { ...base, content, ...(isImage(mimeType) ? { preview: `data:${mimeType};base64,${content}` } : {}) };
  } catch (error) {
    return { ...base, problem: `Couldn't attach: ${base.fileName}`, detail: error instanceof Error ? error.message : String(error) };
  }
}
