// Files and pictures in the draft, sent with chat.send's `attachments` the way the window does
// (window/src/composer/attachments.ts, engine/ui/src/pages/chat/attachment-api.ts). The phone has no
// separate upload method: the gateway takes the bytes on the same chat.send the composer already uses.

export type DraftFile = {
  id: string;
  kind: 'file' | 'text';
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** base64 bytes, once read */
  content?: string;
  /** a data: URL for a picture's thumbnail */
  preview?: string;
  origin: 'file' | 'paste';
  problem?: string;
  /** the engine's or the picker's own words for the problem */
  detail?: string;
};

export type AttachmentPolicy = { maxBytes?: number; maxImageBytes?: number };

/** A file the camera, library or document picker returned, before it becomes a chip. */
export type PickedFile = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  content?: string;
};

/** A pick's name, type and reported size, before any bytes are read. */
export type PickMeta = {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
};

/**
 * The engine's advertised ceilings when hello omits policy.attachments
 * (engine/src/gateway/chat-attachment-policy.ts: 20 MiB files, 6 MiB images).
 */
export const DEFAULT_ATTACHMENT_POLICY: Required<AttachmentPolicy> = {
  maxBytes: 20 * 1024 * 1024,
  maxImageBytes: 6 * 1024 * 1024,
};

/** The read stopped because the stream went past the size ceiling. */
export class OversizeReadError extends Error {
  constructor(readonly sizeBytes: number) {
    super('Too large to send');
    this.name = 'OversizeReadError';
  }
}

export type HelloAttachments = {
  features?: { methods?: readonly string[] };
  policy?: { attachments?: AttachmentPolicy };
};

/** chat.send is the method that carries attachments; the phone gateway has no upload RPC of its own. */
export const CHAT_SEND = 'chat.send';

export const NO_ATTACH_METHOD_NOTE = 'This computer can’t take attachments from this phone.';

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** True when this handshake offers chat.send, the method attachments ride on. */
export function canSendAttachments(hello: HelloAttachments | null | undefined): boolean {
  return Boolean(hello?.features?.methods?.includes(CHAT_SEND));
}

/** The engine's own limits from hello.policy.attachments. */
export function attachmentPolicy(hello: HelloAttachments | null | undefined): AttachmentPolicy | undefined {
  const policy = hello?.policy?.attachments;
  return policy && (policy.maxBytes !== undefined || policy.maxImageBytes !== undefined) ? policy : undefined;
}

/** Hello's limits when present, else the engine's 20 MiB / 6 MiB defaults. */
export function resolvedAttachmentPolicy(hello: HelloAttachments | null | undefined): AttachmentPolicy {
  const fromHello = attachmentPolicy(hello);
  return {
    maxBytes: fromHello?.maxBytes ?? DEFAULT_ATTACHMENT_POLICY.maxBytes,
    maxImageBytes: fromHello?.maxImageBytes ?? DEFAULT_ATTACHMENT_POLICY.maxImageBytes,
  };
}

/** The decoded-size ceiling for this MIME, window fallback order then the engine defaults. */
export function attachmentLimit(mimeType: string, policy: AttachmentPolicy | undefined): number {
  if (isImage(mimeType)) return policy?.maxImageBytes ?? policy?.maxBytes ?? DEFAULT_ATTACHMENT_POLICY.maxImageBytes;
  return policy?.maxBytes ?? DEFAULT_ATTACHMENT_POLICY.maxBytes;
}

/** The problem with a file before it is read, from the engine's own limits (hello.policy.attachments). */
export function sizeProblem(name: string, mimeType: string, size: number, policy: AttachmentPolicy | undefined): string | undefined {
  return size > attachmentLimit(mimeType, policy) ? `Too large to send: ${name}` : undefined;
}

/**
 * Window order (readDraftFile): reject on the reported size before any read. When the picker
 * does not know the size, `read` is called with the ceiling and must stop at that many bytes.
 */
export async function readIfWithinLimit(
  meta: PickMeta,
  policy: AttachmentPolicy | undefined,
  read: (maxBytes: number) => Promise<Uint8Array>,
): Promise<PickedFile> {
  const fileName = meta.fileName || 'file';
  const mimeType = meta.mimeType || 'application/octet-stream';
  const sizeBytes = meta.sizeBytes ?? 0;
  const maxBytes = attachmentLimit(mimeType, policy);
  if (sizeBytes > 0 && sizeProblem(fileName, mimeType, sizeBytes, policy)) {
    return { fileName, mimeType, sizeBytes };
  }
  try {
    const bytes = await read(maxBytes);
    if (bytes.byteLength > maxBytes) return { fileName, mimeType, sizeBytes: bytes.byteLength };
    return { fileName, mimeType, sizeBytes: sizeBytes || bytes.byteLength, content: encodeBase64(bytes) };
  } catch (error) {
    if (error instanceof OversizeReadError) return { fileName, mimeType, sizeBytes: error.sizeBytes };
    throw error;
  }
}

/** The size in the chip, in the units people read. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Preparing <n> attachments…" (one: "Preparing 1 attachment"). */
export function preparingLine(n: number): string {
  return n === 1 ? 'Preparing 1 attachment' : `Preparing ${n} attachments…`;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
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
      type: isImage(f.mimeType) ? 'image' : 'file',
      mimeType: f.mimeType,
      fileName: f.fileName,
      origin: f.origin,
      content: f.content,
    }));
}

/** Turns a picked photo or file into a chip. A size problem never keeps `content`. */
export function readPickedFile(id: string, picked: PickedFile, origin: DraftFile['origin'], policy: AttachmentPolicy | undefined): DraftFile {
  const mimeType = picked.mimeType || 'application/octet-stream';
  const sizeBytes = picked.sizeBytes || (picked.content ? Math.floor((picked.content.length * 3) / 4) : 0);
  const base: DraftFile = { id, kind: 'file', fileName: picked.fileName || 'file', mimeType, sizeBytes, origin };
  const problem = sizeProblem(base.fileName, mimeType, sizeBytes, policy);
  if (problem) return { ...base, problem };
  if (!picked.content) return { ...base, problem: `Couldn't attach: ${base.fileName}` };
  return { ...base, content: picked.content, ...(isImage(mimeType) ? { preview: `data:${mimeType};base64,${picked.content}` } : {}) };
}

/** Words in the outgoing bubble when the send has no typed text. */
export function attachmentSendLabel(attachments: readonly { fileName?: unknown }[]): string {
  if (attachments.length === 1) return String(attachments[0]?.fileName || 'Sent a file');
  return `Sent ${attachments.length} files`;
}
